# Salesforce PDF Generation — New Developer Context

This document gives you everything you need to understand the system before you touch code. It describes **what we’re building, why, how it’s stitched together, and the guardrails** you must not cross.

---

## 1) Problem Statement & Outcome

**Goal**: Generate **PDF documents from Salesforce data** (supporting tables and simple calculations) using **docx-templates**, initiated **interactively** (button on a record) or via **mass (batch) generation**, then **upload the result back to Salesforce Files** and optionally return a **download link** to the browser.

**Non‑negotiable constraints** (do not deviate):

* **Runtime**: Node.js (TypeScript) + Fastify; **single container** runs API and **internal worker** (poller).
* **Conversion**: `soffice --headless` (LibreOffice) via **bounded worker pool**.
* **Container base**: `debian:bookworm-slim`.
* **Hosting**: **Azure Container Apps (ACA)**, **UK South**, **2 vCPU / 4 GB RAM**.
* **Concurrency limit per instance**: **8 doc jobs** concurrently; temp workdir: `/tmp`.
* **Inbound auth (Salesforce → Node)**: **Azure AD** OAuth2 **client credentials** via **Salesforce Named Credential**.
* **Outbound auth (Node → Salesforce)**: **JWT Bearer Flow** with an **Integration User**.
* **Templates**: **Salesforce Files (ContentVersion)** attached to **Docgen Template** custom object.
* **Data prep**: **Apex builds JSON envelope** and posts it to Node. **Node does not run SOQL** for template data.
* **Interactive**: **LWC → Apex (@AuraEnabled) → Node**; upload-first; return **ContentVersion** download URL.
* **Batch**: **Apex Batch/Queueable** creates `Generated_Document__c` rows; Node poller pulls work and generates.
* **Lifecycle**: Status = `QUEUED, PROCESSING, SUCCEEDED, FAILED, CANCELED`; **max 3 retries** with **1m/5m/15m** backoff.
* **Polling**: every **15s**, fetch **50** rows, **concurrency=8**, **lock TTL=2m**.
* **Idempotency**: `RequestHash` (External ID) from `{templateId, data checksum, output format}`.
* **Caching**: Templates cached **immutably by ContentVersionId**; images prefer **base64**; external images must be **allowlisted**.
* **Files & links**: Store PDF (always) + optionally merged DOCX; link `ContentDocument` to **all present parent IDs** (Account/Opportunity/Case).

---

## 2) How It Works (End-to-End)

```mermaid
sequenceDiagram
  autonumber
  participant U as User (Browser)
  participant L as LWC Button
  participant AX as Apex Controller
  participant NC as Named Credential (AAD client creds)
  participant N as Node (Fastify API + Worker)
  participant SF as Salesforce (REST & Files)
  rect rgb(235,245,255)
  Note over U,L,AX,N,SF: Interactive (upload-first; return download link)
  U->>L: Click "Generate PDF"
  L->>AX: @AuraEnabled(recordId, templateId)
  AX->>AX: Build JSON envelope (+preformatted fields, RequestHash)
  AX->>NC: POST /generate (AAD client credentials)
  NC->>N: POST /generate (Bearer <AAD JWT>)
  N->>SF: Download template (ContentVersionId)
  N->>N: Merge (docx-templates)
  N->>N: Convert DOCX→PDF (soffice --headless)
  N->>SF: Upload ContentVersion; create ContentDocumentLink(s)
  N-->>NC: 200 {downloadUrl, contentVersionId}
  AX-->>L: Return downloadUrl
  L-->>U: Open PDF
  end
  rect rgb(245,235,255)
  Note over AX,N,SF: Batch (poller-driven)
  AX->>SF: Batch/Queueable inserts Generated_Document__c rows (QUEUED)
  loop every 15s
    N->>SF: Pick up to 50 QUEUED rows (not locked), set LockedUntil=now+2m, Status=PROCESSING
    par up to 8 concurrent
      N->>SF: Fetch template by ContentVersionId
      N->>N: Merge → Convert
      N->>SF: Upload + link; set Status=SUCCEEDED; OutputFileId__c
    and on failure
      N->>SF: Attempts++ and schedule per backoff; set FAILED if >3
    end
  end
```

**Why upload-first?**
Salesforce Files offers versioning, sharing, and governance. Returning a URL (not bytes) reduces browser memory usage and keeps a unified audit trail.

---

## 3) Data Contract (Apex → Node)

Node receives a **single JSON envelope**. Apex is responsible for collecting and **preformatting** display values (currency/date/number), calculating the **idempotency hash**, and optionally embedding images (base64 preferred).

### Envelope shape (canonical)

```json
{
  "templateId": "<CONTENT_VERSION_ID>",
  "outputFileName": "Opportunity_{{Opportunity.Name}}.pdf",
  "outputFormat": "PDF",
  "locale": "en-GB",
  "timezone": "Europe/London",
  "options": {
    "storeMergedDocx": false,
    "returnDocxToBrowser": true
  },
  "parents": {
    "AccountId": "001xxxxxxxxxxxx",
    "OpportunityId": "006xxxxxxxxxxxx",
    "CaseId": null
  },
  "data": {
    "Account": { "Name": "Acme Ltd", "AnnualRevenue__formatted": "£1,200,000" },
    "Opportunity": {
      "Name": "FY25 Renewal",
      "CloseDate__formatted": "31 Oct 2025",
      "TotalAmount__formatted": "£250,000",
      "LineItems": [
        { "Name": "SKU-A", "Qty": 10, "UnitPrice__formatted": "£1,000", "LineTotal__formatted": "£10,000" }
      ]
    }
  },
  "requestHash": "sha256:<hash>"
}
```

**Field-path convention**: **Salesforce API style**; in templates use `{{Account.Name}}`, `{{Opportunity.TotalAmount__formatted}}`.
**Lists & blocks** (docx-templates):

* Loop: `{{#each Opportunity.LineItems}} {{Name}} – {{Qty}} x {{UnitPrice__formatted}} {{/each}}`
* Conditional: `{{#if Account.IsPartner}}Partner Terms{{/if}}`
* Simple aggregates: docx-templates supports inline JS; however **prefer Apex-precomputed values** to keep templates deterministic.

**Download URL pattern** (returned to browser):
`https://<SF_DOMAIN>/sfc/servlet.shepherd/version/download/<ContentVersionId>`

**Idempotency**: `RequestHash = sha256(templateId | outputFormat | sha256(canonical_json(data)))`. Node **honours** this to avoid duplicate work.

---

## 4) Salesforce Side (Configuration & Logic)

### Custom Objects

* **Docgen Template (`Docgen_Template__c`)**
  Fields:

  * `Name`
  * `TemplateContentVersionId__c` (Text 18) — ContentVersionId of the DOCX template
  * `DataSource__c` (Picklist: `SOQL|Custom`)
  * `SOQL__c` (Long Text) — used by the default provider
  * `ClassName__c` (Text) — optional custom provider
  * `StoreMergedDocx__c` (Checkbox)
  * `ReturnDocxToBrowser__c` (Checkbox)
  * `PrimaryParent__c` (Picklist: `Account|Opportunity|Case`)
  * … (admin meta and audit)

* **Generated Document (`Generated_Document__c`)**
  Fields:

  * `AccountId`, `OpportunityId`, `CaseId` (Lookups)
  * `Template__c` (Lookup → `Docgen_Template__c`)
  * `RequestJSON__c` (Long Text; store full envelope)
  * `Status__c` (Picklist: `QUEUED, PROCESSING, SUCCEEDED, FAILED, CANCELED`)
  * `Priority__c` (Number)
  * `Attempts__c` (Number, default 0)
  * `LockedUntil__c` (Datetime)
  * `Error__c` (Long Text)
  * `CorrelationId__c` (Text 36)
  * `RequestHash__c` (Text 80, **External ID, Unique**)
  * `OutputFileId__c` (Text 18; ContentVersionId)
  * `RequestedBy__c` (Lookup User)
  * `OutputFormat__c` (Picklist: `PDF,DOCX`)

### Apex Services

* **`DocgenDataProvider`** (interface) with default **SOQL** provider reading `tmpl.SOQL__c`. Custom providers can be plugged via `ClassName__c`.
* **`DocgenEnvelopeService`**: composes the envelope, **preformats** display values, computes **`RequestHash`**.
* **Interactive Controller (@AuraEnabled)**: inserts `Generated_Document__c` (sets `PROCESSING`), calls Node via Named Credential, handles success/failure and returns the **download URL**.
* **Batch/Queueable**: inserts many `Generated_Document__c` rows with `QUEUED`; **Node poller** does the heavy work.

### Named Credential (AAD client credentials)

* Authenticates the call to Node (`/generate`) with **client credentials** (audience = Node’s configured client ID; issuer = AAD tenant).
* Keeps endpoint and secrets **out of Apex** code.

### LWC Button

* Small UX wrapper: shows spinner; calls the controller; opens returned URL; displays toast on error.

### ContentDocumentLink Strategy

* After upload, link `ContentDocument` to **each non-null parent** ID.
* `ShareType = V`, `Visibility = AllUsers`.
* Ensures discoverability from Account, Opportunity, and Case.

---

## 5) Node Service (API + Worker) — Components & Responsibilities

**Process model**: One container, two cooperating roles: **HTTP API** and **poller** (internal loop).

### Modules

1. **Inbound Auth (AAD JWT)**

   * Validate via OpenID metadata for `<AZURE_TENANT_ID>`.
   * Enforce `iss`, `aud=<CLIENT_ID>`, `exp`, `nbf` and signature.
   * All `/generate` requests must carry a valid Bearer token.

2. **Request Validation (OpenAPI / Fastify schema)**

   * Enforce presence/type/enum for `templateId`, `outputFormat`, `options`, `parents`, `data`.

3. **Salesforce Auth (JWT Bearer)**

   * Sign JWT (private key from `<KEY_VAULT_URI>`).
   * Exchange for access token bound to the **Integration User**.
   * Cache token until expiry; auto-refresh on 401.

4. **Template Store**

   * Download DOCX by **ContentVersionId** and cache **immutably** (Map keyed by ID).
   * Cache TTL is infinite (ContentVersion is immutable).

5. **Merge Engine (docx-templates)**

   * Feed the **Apex-prepared** `data` object.
   * **Prefer base64 images**; resolve `https` images **only** if host is on allowlist.
   * Implement safe evaluation: no arbitrary code; simple tag expressions only.

6. **Conversion Pool (LibreOffice)**

   * Wrap `soffice --headless` in a pool limited to **8 concurrent** jobs (per instance).
   * Work in `/tmp/<correlationId>/`; robust cleanup; kill long-running processes; timeout (e.g., 60s).
   * Returns PDF buffer (and optionally keep merged DOCX).

7. **Uploader & Linker**

   * Create `ContentVersion` (binary payload).
   * Link `ContentDocument` to parents (`ContentDocumentLink`).
   * Update `Generated_Document__c.OutputFileId__c` and `Status__c`.

8. **Idempotency Gate**

   * Query by `RequestHash__c`. If an existing record is `SUCCEEDED`, **return prior `ContentVersionId`** and **skip processing**.

9. **Poller (Batch)**

   * Every **15s**: select up to **50** `QUEUED` rows not currently locked; set `LockedUntil = now+2m` and `Status=PROCESSING`.
   * Process with **concurrency=8**.
   * On failure: increment `Attempts`; compute **next schedule** by backoff (1m → 5m → 15m). After 3 attempts → `FAILED`.
   * Ensure **single-writer semantics** with lock checks.

10. **Observability (Azure Application Insights)**

    * **Correlation ID** per request; propagate to Salesforce updates.
    * Metrics:

      * `docgen_duration_ms{templateId, outputFormat, mode}`
      * `docgen_failures_total{reason}`
      * `queue_depth`
      * `retries_total`
    * Structured logs and traces around merge/convert/upload phases.

---

## 6) Security & Compliance

* **Inbound AAD JWT**: validate `iss` (tenant), `aud` (our API’s client ID), `exp/nbf`, signature (JWKS). Non-matching → 401/403.
* **Outbound JWT Bearer (Salesforce)**: **Integration User** has **least privilege**:

  * Files: create/read
  * Custom objects: R/W for `Docgen_Template__c` and `Generated_Document__c`
  * Disallow broad CRUD beyond needs.
* **PII & Logs**: No raw payloads in logs. Redact common PII patterns (emails, phone, DOB) and any field marked sensitive.
* **Storage**: `RequestJSON__c` keeps full envelope for audit; if **Shield** is available, enable **encryption-at-rest**.
* **Images**: External URIs must be on an **allowlist**; prefer **base64**.
* **Fonts**: Bundle only fonts with cleared licenses.
* **Secrets**: No secrets in env vars in production. Fetch at startup from **Key Vault** over **Managed Identity**.

---

## 7) Template Authoring (docx-templates) — Ground Rules

* **Tags reflect Salesforce API paths**: `{{Account.Name}}`, `{{Opportunity.Owner.Name}}`.
* **Display values**: Use Apex-provided fields with `__formatted` suffix (e.g., `TotalAmount__formatted`) to keep locale/timezone rules centralized.
* **Tables**:

  ```
  {{#each Opportunity.LineItems}}
  {{Name}} | {{Qty}} | {{UnitPrice__formatted}} | {{LineTotal__formatted}}
  {{/each}}
  ```
* **Optionals**: `{{#if Opportunity.IsWon}}Congratulations{{/if}}`
* **Images**: `{{{LogoBase64}}}` (docx-templates allows base64 image injection).
* **Debugging**: When in doubt, log the final `data` object on the Node side **only in non-prod** with redaction; never dump full payload in prod logs.

---

## 8) Performance Expectations & Limits

* **Instance**: 2 vCPU / 4 GB (ACA).
* **Concurrency**: strictly **8** active conversions per instance (soffice is CPU/memory heavy).
* **Interactive**: **5–10 docs/min** per instance is the target (depends on template size and LibreOffice cold state).
* **Batch**: Designed to handle **50k+** documents over time via the poller with backpressure and retries.
* Scale **horizontally** by increasing ACA replicas; poller lock protocol prevents double work.

---

## 9) Failure Modes & Recovery

* **Template missing/corrupt** → 4xx/5xx from SF download; mark `FAILED`, capture message in `Error__c`.
* **Merge error** (bad tag, missing field) → return clear error; no partial files uploaded.
* **LibreOffice hang/crash** → **timeout** and kill; attempt **retry** with backoff.
* **Upload failure** → retry transient errors; on permanent failure, set `FAILED`.
* **Stuck locks** → records with `PROCESSING` and stale `LockedUntil` are eligible for re-pick (next poll).
* **Idempotency** → repeated requests with identical `RequestHash` immediately reuse prior `ContentVersionId`.
* **Runbook** (abridged):

  * Alert on `docgen_failures_total` surge or `queue_depth` high sustained.
  * Inspect `Error__c` samples; remediate template/data issues.
  * For stuck locks: verify time since `LockedUntil`; poller should reclaim automatically after TTL.

---

## 10) Dev Environment & Workflow

### Prereqs

* Node.js 20+, Yarn/NPM, Docker (for local image build), **Salesforce CLI (sfdx)**.
* Access to a Dev Hub / Scratch Org or Sandbox.
* Azure CLI (for ACA/Key Vault if you deploy locally to Azure).

### Local Development

* **Node service** runs with **stubbed** AAD/Salesforce for tests.
* Unit/integration tests use **Jest + ts‑jest + Supertest + Nock**; **no real external calls**.
* Start server locally with **mock mode** for manual testing. Example env:

  ```
  PORT=8080
  SF_DOMAIN=<SF_DOMAIN>
  AZURE_TENANT_ID=<...>
  CLIENT_ID=<...>
  KEY_VAULT_URI=<...>     # in dev, may be replaced by local PEM path
  IMAGE_ALLOWLIST=cdn.example.com,images.company.com
  ```

### Directory Layout (high level)

```
/src
  /auth          # AAD JWT validator
  /sf            # Salesforce JWT bearer auth + REST client
  /templates     # Template cache + merge
  /convert       # LibreOffice pool
  /routes        # Fastify routes (/generate, /healthz, /readyz)
  /worker        # Poller loop
  /obs           # App Insights wrapper
  /config        # Secrets/bootstrap
/test            # Jest tests (unit + integration; Nock at boundaries)
/docs            # ADRs, runbooks, dashboards, template authoring guide
/force-app       # Apex classes, LWC, metadata (objects, fields, NC)
```

### Testing Strategy (TDD)

* **Node**:

  * **Jest + Supertest** for HTTP behaviour; **Nock** at **external boundaries** (AAD, Salesforce).
  * Assert **observables only**: HTTP status/payload, Salesforce REST calls made, persisted IDs, idempotent effects, metrics emitted.
* **Salesforce**:

  * **Apex `@isTest`** with **`HttpCalloutMock`** for Node calls.
  * Assert **record mutations**: `Generated_Document__c` status transitions, `OutputFileId__c` set, upserts by `RequestHash__c`.

---

## 11) Deployment & Ops (Azure)

* **Container**: `debian:bookworm-slim`; install `libreoffice`, common fonts; expose `8080`.
* **ACA (UK South)**: 2 vCPU / 4 GB; minReplicas=1, maxReplicas=5 (autoscale on CPU ≥ 70% or custom `queue_depth`).
* **Ingress**: HTTPS only; **AAD auth** configured (audience matches Node). Optional WAF/App Gateway sits in front.
* **Secrets**: **Key Vault**; app uses **Managed Identity** to fetch secrets at startup.
* **Health**: `/healthz` (liveness), `/readyz` (readiness after secrets and external checks).
* **Cold start**: Expect slower first conversions due to LibreOffice JIT/cache warmup.

---

## 12) What You Build vs. What You Don’t

**In scope now**

* DOCX→PDF pipeline w/ docx-templates.
* Interactive and batch flows.
* Salesforce Files upload + multi-parent linking.
* Observability, idempotency, security hardening.

**Explicitly out of scope (for now)**

* **DocuSign integration** runtime. We only add **design hooks**: fields for `EnvelopeId` and `Status`, and documented webhook entry points.

---

## 13) Quick Reference — Key Interfaces & Fragments

### OpenAPI (excerpt) — `POST /generate`

```yaml
paths:
  /generate:
    post:
      summary: Interactive document generation
      security: [{ oauth2: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/DocgenRequest'
      responses:
        '200':
          description: Uploaded; returns ContentVersion URL
          content:
            application/json:
              schema:
                type: object
                properties:
                  downloadUrl: { type: string }
                  contentVersionId: { type: string }
                  correlationId: { type: string }
components:
  schemas:
    DocgenRequest:
      type: object
      required: [templateId, outputFileName, locale, timezone, outputFormat, data, options]
      properties:
        templateId: { type: string }
        outputFileName: { type: string }
        outputFormat: { type: string, enum: [PDF, DOCX] }
        locale: { type: string, example: en-GB }
        timezone: { type: string, example: Europe/London }
        options:
          type: object
          properties:
            storeMergedDocx: { type: boolean }
            returnDocxToBrowser: { type: boolean }
        data: { type: object, additionalProperties: true }
        parents:
          type: object
          properties:
            AccountId: { type: string, nullable: true }
            OpportunityId: { type: string, nullable: true }
            CaseId: { type: string, nullable: true }
        requestHash: { type: string }
```

### Minimal Fastify route skeleton

```ts
// src/routes/generate.ts
app.post('/generate', { preHandler: [aadAuth, validateDocgenSchema] }, async (req, reply) => {
  const corr = correlationId(req, reply);
  const env = req.body as DocgenRequest;
  const existing = await sf.findByRequestHash(env.requestHash);
  if (existing?.status === 'SUCCEEDED') {
    return reply.send(reuseResponse(existing, corr));
  }
  const template = await templates.get(env.templateId);
  const merged = await mergeDocx(template, env.data);
  const pdf = env.outputFormat === 'PDF' ? await convertDocxToPdf(merged) : merged;
  const upload = await sf.uploadAndLink({ pdf, docx: env.options.storeMergedDocx ? merged : undefined, parents: env.parents, fileName: env.outputFileName });
  await sf.updateGeneratedDocument(env.requestHash, { status: 'SUCCEEDED', outputFileId: upload.contentVersionId });
  return reply.send({ downloadUrl: upload.downloadUrl, contentVersionId: upload.contentVersionId, correlationId: corr });
});
```

---

## 14) First-Week Checklist for a New Developer

1. **Read** this document end-to-end; skim the ADRs (runtime, auth, worker, caching/idempotency).
2. **Run tests** locally (`jest`); observe failing tests if you haven’t scaffolded (Task T‑01 will).
3. **Explore samples** in `/docs/template-authoring.md` and `/samples/*.json`.
4. **Understand** the **idempotency contract**; trace it through Apex → Node → Salesforce.
5. **Scan** the **poller** algorithm and **LibreOffice pool** constraints (why limit=8).
6. **Review** security: AAD inbound checks; Integration User permissions; image allowlist.
7. **Try** a dry-run merge locally with a small sample template (no real SF/AAD calls; use mocks).
8. **Familiarize** with App Insights metric names and correlation IDs.

---

## 15) Glossary

* **ContentVersion**: A specific binary version of a Salesforce **File**. Identified by `ContentVersionId`.
* **ContentDocument**: Logical file object; a file has many versions.
* **ContentDocumentLink**: Links a `ContentDocument` to another object (e.g., Account, Opportunity, Case).
* **docx-templates**: JS library that fills placeholders in DOCX using a data object.
* **Idempotency**: Same inputs → same output without duplicate side effects; implemented by `RequestHash`.
* **Poller**: Internal worker that continuously scans for queued jobs to process.
* **AAD**: Azure Active Directory (now Entra ID). Used for inbound API auth (client credentials).
* **JWT Bearer Flow**: Salesforce OAuth flow used by **Node → Salesforce** with a signed assertion.

---

## 16) Guiding Principles

* **Contract-first**: Schemas and Apex/Node contracts are the source of truth.
* **Boundary tests** > unit internals: assert observable behaviour, not implementation details.
* **Fail fast, fail clear**: explicit error categories and actionable messages.
* **Minimal privilege** everywhere.
* **Deterministic templates**: precompute everything possible in Apex.

---

With this context, you can start the **Task-by-Task Developer Playbook** confidently, knowing the architecture, the constraints you must respect, and the observable behaviours you need to build and test.
