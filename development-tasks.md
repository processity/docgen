### T-01 — Repo, Runtime & Test Harness Bootstrap

**Goal**: Create the TypeScript/Fastify service skeleton with Jest/ts‑jest/Supertest/Nock and Apex test scaffolding.
**Why it matters**: Establishes a consistent TDD baseline and CI-ready project.
**Prereqs/Dependencies**: Node 20+, SF CLI (sfdx), GitHub/GitLab CI runner.

**Steps (TDD-first)**:

1. Write failing tests for `GET /healthz` (200 JSON), `GET /readyz` (200 when dependencies mocked OK).
2. Add Fastify app with routes and JSON logger; make tests pass.
3. Scaffold Salesforce (Apex) test package with an empty `@isTest` class that compiles.

**Behavioural tests (Given/When/Then)**:

* Given the service starts, When `GET /healthz`, Then 200 with `{status:"ok"}`.
* Given readiness checks mocked healthy, When `GET /readyz`, Then 200 `{ready:true}`; When unhealthy, Then 503.

**Artifacts to commit**:

* `package.json` (scripts: `test`, `dev`, `build`, `start`)
* `tsconfig.json`, `jest.config.ts`, `.nvmrc`
* `src/server.ts`:

  ```ts
  import Fastify from 'fastify';
  export const build = () => {
    const app = Fastify({ logger: true });
    app.get('/healthz', async () => ({ status: 'ok' }));
    app.get('/readyz', async (_req, reply) => reply.code(503).send({ ready: false })); // will be wired later
    return app;
  };
  if (require.main === module) build().then(a => a.listen({ port: 8080, host: '0.0.0.0' }));
  ```
* `test/health.test.ts` (Supertest)
* `/force-app/main/default/classes/Placeholder.cls` + `PlaceholderTest.cls` (compiles)

**Definition of Done**: Tests green locally; CI workflow runs tests on PR.
**Timebox**: ≤2–3 days
**Status**: ✅ **COMPLETED** (2025-11-05)

**Progress checklist**

* [x] Node/TS skeleton runs locally
* [x] Jest + ts-jest + Supertest + Nock installed
* [x] Apex package compiles under sfdx
* [x] CI pipeline runs tests on PR

**PR checklist**
* [x] Tests cover external behaviour and edge cases (5/5 tests passing)
* [x] Security & secrets handled per policy (environment-based config)
* [x] Observability (logs/metrics/traces) added where relevant (correlation IDs, JSON logging)
* [x] Docs updated (README/Runbook/ADR) (README + 4 ADRs created)
* [x] Reviewer notes: risks, roll-back, toggles (documented in ADRs)

**Completion Summary**:
- **Commit**: `46db789` - T-01: Repository, Runtime & Test Harness Bootstrap
- **Files Created**: 26 files (2,918 lines)
- **Test Results**: 5/5 tests passing ✓
- **Build Status**: TypeScript compiles successfully ✓
- **Key Deliverables**:
  - TypeScript/Fastify service with health endpoints
  - Jest test infrastructure (5 passing tests)
  - Salesforce Apex scaffold (Placeholder.cls + PlaceholderTest.cls)
  - Documentation (README + 4 ADRs)
  - GitHub Actions CI/CD workflow
  - ESLint, Prettier, and strict TypeScript configuration

---

### T-02 — System Flows Diagram & ADRs

**Goal**: Capture the end‑to‑end interactive and batch flows and record non‑negotiable decisions.
**Why it matters**: Aligns the team and constrains implementation to required behaviours.
**Prereqs/Dependencies**: T-01.

**Steps (TDD-first)**:

1. Add a docs test that asserts the sequence diagram file exists and ADR list includes required decisions.
2. Write a single Mermaid sequence diagram (interactive + batch).
3. Add ADRs: runtime, container shape, auth directions, worker model, caching, idempotency.

**Behavioural tests (Given/When/Then)**:

* Given docs, When building README, Then Mermaid block found.
* Given `/docs/adrs`, When listing files, Then ADRs for “Single container with internal poller” and “AAD inbound / JWT outbound” exist.

**Artifacts to commit**:

* `README.md` (diagram below included verbatim)
* `docs/adrs/0001-runtime.md`, `0002-auth.md`, `0003-worker-poller.md`, `0004-caching-idempotency.md`

**Mermaid (single diagram)**:

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
  Note over U,L,AX,N,SF: Interactive flow (upload-first, return download link)
  U->>L: Click "Generate PDF"
  L->>AX: @AuraEnabled invoke(recordId, templateId)
  AX->>AX: Build JSON envelope (preformatting, RequestHash)
  AX->>NC: Call POST /generate (AAD client credentials)
  NC->>N: POST /generate (Bearer <AAD JWT>)
  N->>SF: Fetch Template (ContentVersion <ContentVersionId>)
  N->>N: Merge DOCX (docx-templates)
  N->>N: Convert to PDF (soffice --headless)
  N->>SF: Upload ContentVersion + ContentDocumentLink(s)
  N-->>NC: 200 {downloadUrl, contentVersionId}
  AX-->>L: Return downloadUrl
  L-->>U: Open PDF in new tab
  end
  rect rgb(245,235,255)
  Note over AX,N,SF: Batch flow (ACA poller)
  AX->>SF: Batch/Queueable inserts Generated Document rows (QUEUED)
  loop every 15s
    N->>SF: Poll up to 50 rows where Status=QUEUED, not locked
    N->>SF: Lock rows (LockedUntil = now+2m; Status=PROCESSING)
    par up to 8 concurrent
      N->>SF: Fetch Template (by ContentVersionId)
      N->>N: Merge DOCX -> PDF
      N->>SF: Upload ContentVersion; update OutputFileId; set Status=SUCCEEDED
    and on failure
      N->>SF: Increment Attempts; set next run per backoff (1m/5m/15m); set FAILED if >3
    end
  end
  end
```

**Definition of Done**: Diagram committed; ADRs reflect all hard constraints.
**Timebox**: ≤2–3 days
**Status**: ✅ **COMPLETED** (2025-11-05)

**Progress checklist**

* [x] Mermaid diagram added to README
* [x] ADRs capture non‑negotiables
* [x] Docs test ensures presence

**PR checklist**
* [x] Tests cover external behaviour and edge cases (21/21 tests passing)
* [x] Security & secrets handled per policy (no secrets in T-02)
* [x] Observability (logs/metrics/traces) added where relevant (documentation only)
* [x] Docs updated (README/Runbook/ADR) (all 4 ADRs complete)
* [x] Reviewer notes: risks, roll-back, toggles (ADRs document decisions)

**Completion Summary**:
- **Commit**: `5989a10` - T-02: System Flows Diagram & ADRs
- **Files Created**: 1 file (test/docs.test.ts - 62 lines)
- **Test Results**: 21/21 tests passing (16 docs tests + 5 health tests) ✓
- **Key Deliverables**:
  - Mermaid sequence diagram in README.md (interactive + batch flows)
  - ADR 0001: Runtime (Node.js + TypeScript + Fastify + LibreOffice)
  - ADR 0002: Authentication (AAD inbound + JWT Bearer outbound)
  - ADR 0003: Worker Model (internal polling with Salesforce as queue)
  - ADR 0004: Caching & Idempotency (template cache + RequestHash)
  - Documentation validation tests ensure diagram and ADRs exist

---

### T-03 — Data Contract & OpenAPI Skeleton

**Goal**: Define the JSON envelope and validate it via Fastify schema; provide sample payloads.
**Why it matters**: Locks the boundary between Apex and Node; enables contract-first TDD.

**Prereqs/Dependencies**: T-02.

**Steps (TDD-first)**:

1. Write tests: 400 on missing `templateId`, 400 on invalid `outputFormat`, 200 on minimal valid payload.
2. Define Fastify route schema + `openapi.yaml` excerpt for `POST /generate`.
3. Commit sample JSON envelopes for Account/Opportunity/Case.

**Behavioural tests (Given/When/Then)**:

* Given invalid payload, When POST `/generate`, Then 400 with path-specific errors.
* Given valid payload, When POST, Then 202/200 (depending on mode) with correlationId.

**Artifacts to commit**:

* `openapi.yaml` (fragment):

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
          templateId: { type: string, description: ContentVersionId of the template }
          outputFileName: { type: string }
          outputFormat: { type: string, enum: [PDF, DOCX] }
          locale: { type: string, example: en-GB }
          timezone: { type: string, example: Europe/London }
          options:
            type: object
            properties:
              storeMergedDocx: { type: boolean }
              returnDocxToBrowser: { type: boolean }
          data:
            type: object
            additionalProperties: true
          parents:
            type: object
            properties:
              AccountId: { type: string, nullable: true }
              OpportunityId: { type: string, nullable: true }
              CaseId: { type: string, nullable: true }
          requestHash: { type: string, description: External ID for idempotency }
  ```
* **Field path convention**: Salesforce API-style paths, e.g., `Account.Name`, `Opportunity.TotalAmount`. In templates use docx-templates tags like `{{Account.Name}}`, loops `{{#each Opportunity.LineItems}}{{Name}} – {{Quantity}}{{/each}}`.
* `samples/account.json`, `samples/opportunity.json`, `samples/case.json`:

  ```json
  {
    "templateId": "<CONTENT_VERSION_ID>",
    "outputFileName": "Account_Summary_{{Account.Name}}.pdf",
    "outputFormat": "PDF",
    "locale": "en-GB",
    "timezone": "Europe/London",
    "options": { "storeMergedDocx": false, "returnDocxToBrowser": true },
    "parents": { "AccountId": "001xxxxxxxxxxxx", "OpportunityId": null, "CaseId": null },
    "data": {
      "Account": {
        "Name": "Acme Ltd",
        "BillingCity": "London",
        "AnnualRevenue__formatted": "£1,200,000"
      }
    },
    "requestHash": "sha256:<hash>"
  }
  ```

**Definition of Done**: Schema validates; examples parse; OpenAPI builds.
**Timebox**: ≤2–3 days
**Status**: ✅ **COMPLETED** (2025-11-05)

**Progress checklist**

* [x] Schema added & tested
* [x] Examples for Account/Opportunity/Case
* [x] OpenAPI fragment committed

**PR checklist**
* [x] Tests cover external behaviour and edge cases (15/15 new tests passing)
* [x] Security & secrets handled per policy (validation only; auth in T-08)
* [x] Observability (logs/metrics/traces) added where relevant (correlation IDs)
* [x] Docs updated (README/Runbook/ADR) (README + field conventions + OpenAPI)
* [x] Reviewer notes: risks, roll-back, toggles (included in PR description)

**Completion Summary**:
- **PR**: #2 - T-03: Data Contract & OpenAPI Skeleton
- **Branch**: feature/T03
- **Files Created**: 8 files (1,839 lines)
- **Files Modified**: 3 files (108 lines)
- **Test Results**: 36/36 tests passing (added 15 new tests) ✓
- **Build Status**: TypeScript compiles successfully ✓
- **Key Deliverables**:
  - POST /generate route with Fastify schema validation
  - OpenAPI 3.0 specification (417 lines)
  - Sample payloads: account.json, opportunity.json, case.json
  - Field path conventions documentation (461 lines)
  - 11 validation tests + 4 sample tests
  - README updated with endpoint documentation

---

### T-04 — Salesforce Custom Objects & Fields

**Goal**: Create `Docgen_Template__c` and `Generated_Document__c` per spec.
**Why it matters**: Provides configuration and durable state for both flows.

**Prereqs/Dependencies**: T-03.

**Steps (TDD-first)**:

1. Write Apex `@isTest` that inserts minimal valid records into both objects and enforces required fields.
2. Define custom objects/fields (metadata) via sfdx.
3. Add picklist/status defaults and External ID on `RequestHash__c`.

**Behavioural tests (Given/When/Then)**:

* Given a template with `ContentVersionId`, When inserted, Then fields persist and are queryable.
* Given a Generated Document, When inserted with `RequestHash__c` duplicate, Then upsert results in single record.

**Artifacts to commit**:

* `force-app/main/default/objects/Docgen_Template__c/*`

  * Fields (examples): `DataSource__c {SOQL|Custom}`, `SOQL__c`, `ClassName__c`, `StoreMergedDocx__c (Checkbox)`, `ReturnDocxToBrowser__c (Checkbox)`, `PrimaryParent__c (Picklist: Account|Opportunity|Case)`, `TemplateContentVersionId__c (Text 18)`, …
* `force-app/main/default/objects/Generated_Document__c/*`

  * Fields: `AccountId (Lookup)`, `OpportunityId`, `CaseId`, `Template__c (Lookup Docgen_Template__c)`, `RequestJSON__c (Long Text Area)`, `Status__c (Picklist: QUEUED,PROCESSING,SUCCEEDED,FAILED,CANCELED)`, `Priority__c (Number)`, `Attempts__c (Number, default 0)`, `LockedUntil__c (Datetime)`, `Error__c (Long Text)`, `CorrelationId__c (Text 36)`, `RequestHash__c (Text 80, External ID, Unique)`, `OutputFileId__c (Text 18)`, `RequestedBy__c (Lookup User)`, `OutputFormat__c (Picklist: PDF,DOCX)`.

**Definition of Done**: Metadata deploys; tests passing; unique external ID enforced.
**Timebox**: ≤2–3 days
**Status**: ✅ **COMPLETED** (2025-11-06)

**Progress checklist**
* [x] Objects/fields defined
* [x] Unit tests insert/query/update
* [x] External ID uniqueness enforced

**PR checklist**
* [x] Tests cover external behaviour and edge cases (16 Apex tests passing)
* [x] Security & secrets handled per policy
* [x] Observability added (CorrelationId field)
* [x] Docs updated (README + T04-COMPLETION-SUMMARY.md)
* [x] Reviewer notes in PR description

**Completion Summary**:
- **PR**: #3 - https://github.com/bigmantra/docgen/pull/3
- **Branch**: feature/T04
- **CI Status**: ✅ All checks passing (Node.js + Salesforce)
- **Test Results**: 16/16 Apex tests ✓ | 36/36 Node.js tests ✓
- **Files**: 37 changed (1,593 insertions, 33 deletions)
- **Key Fixes**:
  - Parent lookups renamed (Account__c, Opportunity__c, Case__c)
  - GitHub Actions workflow syntax corrected
  - SFDX_AUTH_URL secret configured

---

### T-05 — Apex Data Provider, Envelope Builder & RequestHash

**Goal**: Implement `DocgenDataProvider` and a default SOQL provider; build the envelope with preformatted fields and `RequestHash`.
**Why it matters**: Ensures Node receives a clean, self-contained JSON payload with preformatted values.

**Prereqs/Dependencies**: T-04.

**Steps (TDD-first)**:

1. Apex tests for: preformatting currency/date/number, correct `RequestHash` (sha256 of `{templateId}|{outputFormat}|{checksum(data)}`).
2. Implement `DocgenDataProvider` interface and `StandardSOQLProvider`.
3. Implement `DocgenEnvelopeService` to construct payloads and compute hash.

**Behavioural tests (Given/When/Then)**:

* Given a record, When building envelope, Then numbers/currency/date fields include `__formatted` strings per locale.
* Given stable inputs, When computing `RequestHash`, Then identical hash across runs.

**Artifacts to commit**:

* `DocgenDataProvider.cls`:

  ```apex
  public interface DocgenDataProvider {
    Map<String, Object> buildData(Id recordId, Docgen_Template__c tmpl, String locale, String timezone);
  }
  ```
* `StandardSOQLProvider.cls` (uses `tmpl.SOQL__c` via `Database.query`)
* `DocgenEnvelopeService.cls`:

  ```apex
  public with sharing class DocgenEnvelopeService {
    public class Envelope {
      public String templateId; public String outputFileName; public String outputFormat;
      public String locale; public String timezone; public Map<String,Object> options;
      public Map<String,Object> data; public Map<String,Id> parents; public String requestHash;
    }
    public static Envelope build(Id recordId, Docgen_Template__c tmpl, String fmt, String locale, String tz){
      // hydrate data via provider; add preformatted fields; compute requestHash
      // return Envelope instance
    }
    public static String computeHash(String templateId, String outputFormat, String dataJson){
      Blob hash = Crypto.generateDigest('SHA-256', Blob.valueOf(templateId + '|' + outputFormat + '|' + dataJson));
      return 'sha256:' + EncodingUtil.convertToHex(hash);
    }
  }
  ```
* `DocgenEnvelopeServiceTest.cls` validating formatting & hashing.

**Definition of Done**: Envelope JSON matches T‑03; tests OK.
**Timebox**: ≤2–3 days
**Status**: ✅ **COMPLETED** (2025-11-06)

**Progress checklist**

* [x] Interface + default provider
* [x] Envelope service with hashing
* [x] Apex tests for formatting/hash

**PR checklist**
* [x] Tests cover external behaviour and edge cases (38/38 Apex tests passing)
* [x] Security & secrets handled per policy (no new security concerns)
* [x] Observability (logs/metrics/traces) added where relevant (N/A for Apex-only)
* [x] Docs updated (README/Runbook/ADR) (README + completion summary)
* [x] Reviewer notes: risks, roll-back, toggles (included in PR description)

**Completion Summary**:
- **Branch**: feature/T05
- **CI Status**: ✅ All checks passing (Node.js + Salesforce)
- **Test Results**: 38/38 Apex tests ✓ | 36/36 Node.js tests ✓
- **Test Coverage**: 100% pass rate on new Apex classes
- **Files Created**: 12 files (6 production + 6 metadata)
  - DocgenDataProvider.cls (interface with buildData method)
  - StandardSOQLProvider.cls (SOQL provider with locale-aware formatting)
  - DocgenEnvelopeService.cls (envelope builder with SHA-256 hashing)
  - StandardSOQLProviderTest.cls (13 test methods)
  - DocgenEnvelopeServiceTest.cls (10 test methods)
  - MockCustomProvider.cls (test helper for custom provider pattern)
- **Files Removed**: Placeholder.cls & PlaceholderTest.cls (no longer needed)
- **Key Deliverables**:
  - **DocgenDataProvider Interface**: Pluggable strategy pattern for data collection
  - **StandardSOQLProvider**: Executes template.SOQL__c with :recordId binding
    - Currency formatting: £1,200,000 (en-GB), $250,000 (en-US)
    - Date formatting: 31 Dec 2025 (en-GB), 12/31/2025 (en-US)
    - Number/percentage formatting with locale-specific separators
    - Timezone-aware datetime conversions
    - Adds `__formatted` suffix to all numeric/date/currency fields
  - **DocgenEnvelopeService**: Complete JSON envelope construction
    - Deterministic RequestHash: `sha256:{templateId}|{outputFormat}|{dataJson}`
    - Provider factory (SOQL vs Custom via Type.forName)
    - Parent ID extraction (AccountId, OpportunityId, CaseId)
    - Options mapping from template checkboxes
  - **Test Coverage**: 38 comprehensive test methods
    - Formatting tests (currency, date, datetime, number, percent)
    - Data building with Account records
    - Hash stability and determinism
    - Envelope construction for Account/Opportunity/Case
    - Custom provider pattern validation
    - Null handling and edge cases

---

### T-06 — AAD Named Credential & Apex Interactive Controller

**Goal**: Configure External Credential (AAD client credentials) and implement Apex controller to call Node `/generate`.
**Why it matters**: Enables secure inbound auth (Salesforce → Node).

**Prereqs/Dependencies**: T-05.

**Steps (TDD-first)**:

1. Apex `HttpCalloutMock` tests for: 200 success returns download URL; non-200 sets Generated Document to FAILED with Error__c.
2. Configure Named Credential using AAD client credentials to target Node base URL.
3. Implement `DocgenController` (@AuraEnabled) to: insert `Generated_Document__c` (QUEUED→PROCESSING), call `/generate`, update status & return URL.

**Behavioural tests (Given/When/Then)**:

* Given a mock 200, When invoking controller, Then a record is created, status SUCCEEDED, URL returned.
* Given a mock 500, Then status FAILED with Error__c.

**Artifacts to commit**:

* `force-app/.../namedCredentials/Docgen_Node_NC.namedCredential` (AAD client creds)
* `DocgenController.cls`:

  ```apex
  public with sharing class DocgenController {
    @AuraEnabled
    public static String generate(Id templateId, Id recordId, String outputFormat){
      // build envelope via DocgenEnvelopeService
      // insert Generated_Document__c with Status__c='PROCESSING', RequestJSON__c, RequestHash__c
      // call Named Credential POST /generate (JSON)
      // update OutputFileId__c, Status__c
      // return download URL string
    }
  }
  ```
* `DocgenControllerTest.cls` with `HttpCalloutMock`.

**Definition of Done**: Controller callable; tests pass with mocks; NC configured.
**Timebox**: ≤2–3 days
**Status**: ✅ **COMPLETED** (2025-11-06)

**Progress checklist**

* [x] Named Credential configured (AAD client creds)
* [x] Controller implemented (DocgenController.cls - 243 lines)
* [x] Tests for success/failure paths (DocgenControllerTest.cls - 327 lines)
* [x] Named Credential setup documentation (docs/named-credential-setup.md - 375 lines)
* [x] External Credential & Named Credential metadata files deployed
* [x] .gitignore updated to exclude secrets

**Implementation Summary**:
* **Test Results**: 46/46 tests passing (100% pass rate) ✅
  - 8 DocgenControllerTest methods: ALL PASSING
    - testGenerateSuccess ✅
    - testGenerateServerError ✅
    - testGenerateClientError ✅
    - testIdempotency ✅ (FIXED via idempotency short-circuit pattern)
    - testIdempotencyCacheExpiry ✅ (NEW - validates 24-hour cache window)
    - testMissingTemplate ✅
    - testRecordStatusTransitions ✅
  - All other test classes: 100% passing (DocgenEnvelopeServiceTest, GeneratedDocumentTest, StandardSOQLProviderTest, DocgenTemplateTest)
* **Key Components**:
  - DocgenController: Interactive document generation with HTTP callout to Node API (295 lines)
  - Idempotency short-circuit with 24-hour cache (checkExistingDocument method)
  - Download URL builder helper (buildDownloadUrl method)
  - Mock callout classes for testing (success/error scenarios)
  - Correlation ID generation using UUID v4 format
  - AuraHandledException message handling for LWC consumption
  - Status tracking: PROCESSING → SUCCEEDED/FAILED
  - Code coverage: 89% on DocgenController
* **Security**: AAD OAuth 2.0 Client Credentials flow configured
* **Idempotency Solution**: Implemented cache check BEFORE HTTP callout to prevent DML+callout mixing
  - Checks for existing SUCCEEDED documents within 24 hours (LAST_N_DAYS:1)
  - Returns cached download URL on cache hit (no HTTP callout, no DML)
  - Proceeds with normal flow on cache miss
  - Prevents duplicate document generation for identical requests
  - Protects against user double-clicks and API retries

**Artifacts Committed**:
* DocgenController.cls (295 lines) & DocgenControllerTest.cls (410 lines)
* Docgen_AAD_Credential.externalCredential-meta.xml
* Docgen_Node_API.namedCredential-meta.xml
* docs/named-credential-setup.md
* .env.example
* Updated .gitignore & README.md

**PR checklist**
* [x] Tests cover external behaviour and edge cases (8/8 tests passing)
* [x] Security & secrets handled per policy
* [x] Observability (correlationId tracking) added
* [x] Docs updated (README/named-credential-setup.md)
* [x] Reviewer notes: Idempotency test fixed via cache pattern; improves production behavior

---

### T-07 — LWC Button UX & ContentDocumentLink Strategy

**Goal**: Provide a simple LWC button for interactive generation and define linking to all present parents.
**Why it matters**: Delivers the user-facing trigger and ensures files are discoverable from related records.

**Prereqs/Dependencies**: T-06.

**Steps (TDD-first)**:

1. Jest LWC tests: shows spinner; on success opens returned URL; on failure shows toast.
2. Implement LWC calling `DocgenController.generate`.
3. Document `ContentDocumentLink` strategy (link to Account/Opportunity/Case if non-null).

**Behavioural tests (Given/When/Then)**:

* Given a click, When controller returns URL, Then window opens and toast "Generated".
* Given error, Then toast "Failed" with reason.

**Artifacts to commit**:

* `force-app/.../lwc/docgenButton/*` (HTML/JS/meta)
* `docs/contentdocumentlink.md` describing: create `ContentDocumentLink` for each parent with `ShareType=V`, `Visibility=AllUsers`.

**Definition of Done**: Button deploys; opens download; linking strategy documented.
**Timebox**: ≤2–3 days
**Status**: ✅ **COMPLETED** (2025-11-07)

**Progress checklist**

* [x] LWC built & unit tested (12/12 tests passing)
* [x] UX: spinner, success/fail toasts (fully implemented)
* [x] Linking strategy documented (docs/contentdocumentlink.md)
* [x] LWC Jest infrastructure set up (@salesforce/sfdx-lwc-jest)
* [x] Component is configurable (templateId, outputFormat, buttonLabel, successMessage)
* [x] Component deployable to Record/App/Home pages

**PR checklist**
* [x] Tests cover external behaviour and edge cases (12 comprehensive LWC tests + 93 Node.js tests passing)
* [x] Security & secrets handled per policy (no new security concerns)
* [x] Observability (logs/metrics/traces) added where relevant (N/A for LWC-only task)
* [x] Docs updated (README/Runbook/ADR) (contentdocumentlink.md + T07-COMPLETION-SUMMARY.md)
* [x] Reviewer notes: risks, roll-back, toggles (included in completion summary)

**Completion Summary**:
- **Files Created**: 8 files (LWC component + tests + config + docs)
- **Test Results**: 12/12 LWC tests ✅ | 93/93 Node.js tests ✅ (105 total)
- **Key Deliverables**:
  - **docgenButton LWC Component**: Configurable button for interactive PDF/DOCX generation
    - HTML template with button + spinner (372 bytes)
    - JavaScript controller with Apex integration + error handling (4,291 bytes)
    - Metadata with exposed properties (1,397 bytes)
    - Comprehensive Jest tests (12,482 bytes, 12 scenarios)
  - **LWC Jest Infrastructure**: Complete test framework setup
    - @salesforce/sfdx-lwc-jest installed (111 packages)
    - jest.config.lwc.js configuration
    - .forceignore for deployment exclusions
    - Test scripts in package.json (test:lwc, test:lwc:watch, test:lwc:coverage)
  - **ContentDocumentLink Documentation**: Strategy for linking files to parents (7,812 bytes)
    - Comprehensive markdown with Mermaid diagrams
    - Examples for Account/Opportunity/Case scenarios
    - Security considerations and future enhancements
  - **Component Features**:
    - Admin-configurable properties (templateId, outputFormat, buttonLabel, successMessage)
    - Spinner during processing + button disabled state
    - Success: Opens download URL in new tab + shows success toast
    - Error: Shows error toast with message + re-enables button
    - Validation: Checks for required properties (templateId, outputFormat)
    - Deployment targets: Record/App/Home pages

---

### T-08 — AAD JWT Validation (Inbound) & Request Validation

**Goal**: Enforce Azure AD (Entra ID) client credentials JWT validation and Fastify schema checks on `/generate`.
**Why it matters**: Secures the API and guards against malformed payloads.

**Prereqs/Dependencies**: T-03.

**Steps (TDD-first)**:

1. Tests: 401 for missing/invalid token; 403 for wrong `aud` or `iss`; 200 for valid token.
2. Implement AAD JWT verifier (OpenID metadata for `<AZURE_TENANT_ID>`; cache JWKS; audience `<CLIENT_ID>`).
3. Wire into Fastify preHandler; attach `correlationId` header propagation.

**Behavioural tests (Given/When/Then)**:

* Given an invalid token, When POST `/generate`, Then 401.
* Given a valid token but wrong audience, Then 403.

**Artifacts to commit**:

* `src/auth/aad.ts` (jwt verify using `jsonwebtoken` + JWKS client)
* `src/plugins/validation.ts` (Fastify schema)
* `test/auth.test.ts` (Supertest + stubbed JWKS)

**Definition of Done**: Auth enforced; all negative/positive tests pass.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] AAD validation implemented
* [ ] Request schema enforced
* [ ] CorrelationId propagation in logs
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-09 — Salesforce Client via JWT Bearer (Outbound)

**Goal**: Implement Node → Salesforce auth with Integration User using JWT Bearer Flow, with token caching/refresh.
**Why it matters**: Enables template fetch & file upload.

**Prereqs/Dependencies**: T-08.

**Steps (TDD-first)**:

1. Tests with Nock: successful token exchange, token reuse until expiry, refresh on 401.
2. Implement `SalesforceAuth` (sign JWT with private key from `<KEY_VAULT_URI>`; audience `https://login.salesforce.com`).
3. Implement `SalesforceApi` wrapper: GET/POST to REST & tooling endpoints with retry/backoff.

**Behavioural tests (Given/When/Then)**:

* Given cached token, When calling twice, Then only one token request sent.
* Given expired token, Then refresh occurs transparently.

**Artifacts to commit**:

* `src/sf/auth.ts`, `src/sf/api.ts`
* `test/sf.auth.test.ts`, `test/sf.api.test.ts`
* Config placeholders: `<SF_DOMAIN>`, `<CLIENT_ID>`, `<SF_USERNAME>`, `<KEY_VAULT_URI>`

**Definition of Done**: Token acquisition & reuse verified; API wrapper tested.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] JWT Bearer flow implemented
* [ ] Token cache & refresh
* [ ] API wrapper with retries
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-10 — Template Fetch & Immutable Cache + docx-templates Usage

**Goal**: Download template by `ContentVersionId` and cache immutably; implement merging via `docx-templates`.
**Why it matters**: Minimizes SF calls; powers the merge step with field-path conventions.

**Prereqs/Dependencies**: T-09.

**Steps (TDD-first)**:

1. Tests: first fetch hits SF; subsequent by same `ContentVersionId` served from cache; different ID bypasses cache.
2. Implement `TemplateStore` with infinite TTL by ID.
3. Implement `mergeDocx` using docx-templates; enforce image allowlist/base64 preference.

**Behavioural tests (Given/When/Then)**:

* Given an allowlisted image URL, When merging, Then image loads; Given non-allowlisted, Then merge fails with clear error.
* Given arrays in data, When merging, Then tables/loops render.

**Artifacts to commit**:

* `src/templates/store.ts`, `src/templates/merge.ts`:

  ```ts
  export const TEMPLATE_CACHE = new Map<string, Buffer>();
  export async function getTemplate(cvId: string): Promise<Buffer> { /* fetch & cache */ }
  export async function mergeDocx(template: Buffer, data: any): Promise<Buffer> { /* docx-templates */ }
  ```
* `test/templates.test.ts` with Nock for SF download
* `docs/template-authoring.md` (conventions & examples: loops `{{#each Items}}`, conditionals `{{#if Account.IsPartner}}`, aggregates with JS in tags kept simple)

**Definition of Done**: Cache works; merging verified with sample template.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] Template cache by ContentVersionId
* [ ] Merging supports tables/conditionals/images
* [ ] Image allowlist enforced
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-11 — LibreOffice Conversion Pool (`soffice --headless`)

**Goal**: Convert merged DOCX to PDF via a bounded worker pool (max 8 concurrent).
**Why it matters**: Meets ACA sizing and reliability constraints.

**Prereqs/Dependencies**: T-10.

**Steps (TDD-first)**:

1. Tests: success path (PDF buffer returned), timeout path (kill process), crash path (non-zero exit).
2. Implement pool (limit=8) wrapping `child_process.execFile('soffice', ...)` with timeouts and `/tmp` workdir lifecycle.
3. Expose `convertDocxToPdf(buf: Buffer): Promise<Buffer>`.

**Behavioural tests (Given/When/Then)**:

* Given 10 jobs, When run, Then only 8 run concurrently (queue depth observed).
* Given a hung process, Then it is killed and error surfaced.

**Artifacts to commit**:

* `src/convert/soffice.ts` (pool & conversion)
* `test/convert.test.ts` (mocks child_process)
* Config: timeouts (e.g., 60s), workdir `/tmp`, cleanup on finally.

**Definition of Done**: Pool enforces concurrency; failure modes tested.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] Pool limit=8
* [ ] Timeouts & cleanup
* [ ] Failure injection tests
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-12 — Upload to Salesforce Files & Linking; Idempotency

**Goal**: Create `ContentVersion`, link to parents, set `OutputFileId__c`, and honour idempotency via `RequestHash`.
**Why it matters**: Persists results correctly and prevents duplicate work.

**Prereqs/Dependencies**: T-09, T-10, T-11.

**Steps (TDD-first)**:

1. Tests with Nock: creates ContentVersion; creates ContentDocumentLink(s) for present parents; updates `Generated_Document__c`.
2. Implement idempotency: if an existing Generated Document with same `RequestHash` is `SUCCEEDED`, return existing `ContentVersionId`.
3. Support template options: store PDF always; optionally also store merged DOCX per template config.

**Behavioural tests (Given/When/Then)**:

* Given the same `RequestHash`, When called twice, Then second call returns prior `contentVersionId` without reprocessing.
* Given multiple parents, Then three CDL links exist.

**Artifacts to commit**:

* `src/sf/files.ts` (upload & link functions)
* `test/sf.files.test.ts`
* `docs/idempotency.md` (contract: Apex computes hash; Node honours it)

**Definition of Done**: Upload + link works; idempotent behaviour confirmed.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] ContentVersion upload implemented
* [ ] Parent links created
* [ ] Idempotency enforced
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-13 — `/generate` End‑to‑End Interactive Path

**Goal**: Wire the full interactive pipeline: validate AAD → fetch template → merge → convert → upload → respond with download URL.
**Why it matters**: Delivers the primary user-facing capability.

**Prereqs/Dependencies**: T-08 to T-12.

**Steps (TDD-first)**:

1. Integration tests (Supertest + Nock): full success path returns 200 + URL; failure in LibreOffice returns 502 + error body; metrics emitted.
2. Implement handler with correlation IDs, structured logs, and error mapping.
3. Return `{ downloadUrl, contentVersionId, correlationId }`.

**Behavioural tests (Given/When/Then)**:

* Given valid payload and mocks, When POST `/generate`, Then 200 with a URL that contains `<SF_DOMAIN>`.
* Given conversion failure, Then 502 and `Generated_Document__c.Status__c=FAILED` update call observed.

**Artifacts to commit**:

* `src/routes/generate.ts` (Fastify route)
* `test/generate.int.test.ts`
* OpenAPI response examples updated.

**Definition of Done**: Green integration tests; observable effects (uploads, updates) verified via Nock.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] Full E2E route wired
* [ ] Error handling & mapping
* [ ] Metrics & logs present
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-14 — Batch Enqueue (Apex) & Node Poller Worker

**Goal**: Implement Apex Batch/Queueable to populate `Generated_Document__c` rows and Node poller to process with locks/retries/backoff.
**Why it matters**: Enables mass generation at scale with resilience.

**Prereqs/Dependencies**: T-12, T-13.

**Steps (TDD-first)**:

1. Apex tests: batch inserts rows with `QUEUED`, `RequestJSON__c`, `RequestHash__c`.
2. Node tests: poller selects up to 50 rows, sets `LockedUntil__c = now()+2m`, runs up to 8 concurrent, updates status; retries on failure with 1m/5m/15m backoff up to 3 attempts.
3. Implement poller loop every 15s inside the container process.

**Behavioural tests (Given/When/Then)**:

* Given 60 queued rows, When poll, Then 50 locked and max 8 concurrent processed.
* Given two workers, When locking, Then no double-processing (lock respected).
* Given failures, Then Attempts increments and next run scheduled per backoff.

**Artifacts to commit**:

* `BatchDocgenEnqueue.cls` (Batch/Queueable) + tests
* `src/worker/poller.ts`
* `test/worker.poller.test.ts` (Nock for SF queries/updates)

**Definition of Done**: Poller processes queue deterministically; backoff & retries verified.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] Apex batch/queueable created
* [ ] Poller loop implemented (15s cadence)
* [ ] Locking/backoff tested
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-15 — Observability with Azure Application Insights

**Goal**: Add structured logs, traces, and custom metrics; wire correlation IDs end‑to‑end.
**Why it matters**: Operability and SLOs (e.g., 95th percentile generation time, failure rate).

**Prereqs/Dependencies**: T-13, T-14.

**Steps (TDD-first)**:

1. Tests: metrics client receives `docgen_duration_ms`, `docgen_failures_total`, `queue_depth`, `retries_total`; correlationId included in logs.
2. Implement App Insights SDK wrapper with dependency injection for tests.
3. Add dashboards/alerts definitions (IaC or runbook).

**Behavioural tests (Given/When/Then)**:

* Given a successful request, When route completes, Then `docgen_duration_ms` recorded with `templateId` and `outputFormat` dims.
* Given retry, Then `retries_total` increments.

**Artifacts to commit**:

* `src/obs/insights.ts`, `test/obs.test.ts`
* `docs/dashboards.md` (KPIs, sample KQL)
* Emit headers: `x-correlation-id` support

**Definition of Done**: Metrics/logs emitted and test-validated; docs explain dashboards/alerts.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] Metrics wrapper added
* [ ] Correlation propagation
* [ ] Dashboard/alert docs
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-16 — Containerization & Azure Container Apps (UK South) Deployment

**Goal**: Build Docker image on `debian:bookworm-slim` with LibreOffice & fonts; deploy to ACA (2 vCPU/4 GB) with Key Vault integration.
**Why it matters**: Production-ready hosting with proper sizing, secrets, and ingress.

**Prereqs/Dependencies**: T-11, T-13, T-15.

**Steps (TDD-first)**:

1. Add config validation tests: process exits non‑zero if required env/Key Vault secrets missing.
2. Create Dockerfile, Bicep (or az CLI) for ACA env/app in **UK South**, ingress TLS, AAD audience/issuer, managed identity.
3. Wire startup secret fetch from Key Vault via managed identity.

**Behavioural tests (Given/When/Then)**:

* Given missing `<CLIENT_ID>` or `<KEY_VAULT_URI>`, When starting, Then process fails with clear messages.
* Given healthy config, When container starts, Then `/readyz` returns 200.

**Artifacts to commit**:

* `Dockerfile`:

  ```dockerfile
  FROM debian:bookworm-slim
  RUN apt-get update && apt-get install -y libreoffice ghostscript fonts-dejavu ttf-mscorefonts-installer && \
      apt-get clean && rm -rf /var/lib/apt/lists/*
  WORKDIR /app
  COPY dist/ /app/
  ENV NODE_ENV=production TMPDIR=/tmp
  EXPOSE 8080
  CMD ["node","server.js"]
  ```
* `infra/main.bicep`:

  * ACA environment + app (2 vCPU/4 GB), minReplicas=1, maxReplicas=5 (CPU 70% scale rule)
  * Region **UK South**
  * Ingress HTTPS, AAD auth (audience set)
  * Managed Identity + Key Vault access policies
* `src/config/secrets.ts` (Key Vault fetch at startup)
* `docs/deploy.md` incl. cold‑start & cost notes, and optional WAF/App Gateway.

**Definition of Done**: Image builds; Bicep deploys; app healthy on ACA with AAD-protected ingress.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] Dockerfile with LibreOffice & fonts
* [ ] Bicep for ACA + MI + KV + AAD
* [ ] Startup secret retrieval & validation
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-17 — Security & Compliance Hardening

**Goal**: Enforce least-privilege, AAD JWT checks, PII handling, image allowlist, and font licensing.
**Why it matters**: Reduces risk and aligns with policy.

**Prereqs/Dependencies**: T-08, T-12, T-16.

**Steps (TDD-first)**:

1. Tests: reject non-allowlisted image URLs; reject expired/incorrect `iss/aud` JWT; mask PII in logs.
2. Configure Integration User permissions: Files create/read; custom objects R/W; REST minimal scope.
3. Document retention/caching: store full `RequestJSON__c` (Shield optional encryption), template cache immutable, purge policy.

**Behavioural tests (Given/When/Then)**:

* Given a non-allowlisted CDN, When merging images, Then 400 with reason.
* Given JWT with past `exp`, Then 401.
* Given error logs, Then PII fields (e.g., emails, phone) are redacted.

**Artifacts to commit**:

* `src/security/image-allowlist.ts`
* `test/security.test.ts`
* `docs/security.md` (AAD validation: `aud/iss/exp`; scopes; Shield encryption; retention windows; font licenses)

**Definition of Done**: Policies enforced by code/tests; documentation complete.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] JWT validations strict
* [ ] Integration User least-privilege
* [ ] PII masking & image allowlist
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

### T-18 — Performance, Failure Injection, Rollout & DocuSign Hooks

**Goal**: Prove performance (5–10 docs/min interactive; 50k+ batch), validate failure scenarios, document rollout, and add DocuSign design hooks.
**Why it matters**: Confident release and future extensibility.

**Prereqs/Dependencies**: T-13–T-17.

**Steps (TDD-first)**:

1. Add perf tests (locally with stubs): simulate 10/min interactive and batch 50k with poller; assert SLA via timings/metrics (no real LibreOffice).
2. Failure injection: force `soffice` crash, huge tables, malformed template; assert retries/backoff; stuck lock detector runbook.
3. Add DocuSign hooks (design only): fields on `Generated_Document__c` (`DocuSignEnvelopeId__c`, `DocuSignStatus__c`), event bus placeholders, handler interface (no implementation).

**Behavioural tests (Given/When/Then)**:

* Given batch of 50,000 rows, When poller runs with concurrency=8, Then completes under planned window in stubbed mode and respects backoff for failures.
* Given a crash, Then attempt increments and next schedule matches 1m/5m/15m.
* Given hooks enabled, Then envelopeId can be set later without changing generation flow.

**Artifacts to commit**:

* `test/perf.sim.test.ts` (timing assertions using faked timers)
* `docs/runbook.md` (stuck locks, retries, dashboards, rollback strategy, feature toggles)
* `force-app/.../objects/Generated_Document__c/fields/DocuSignEnvelopeId__c` & `DocuSignStatus__c`
* `docs/extensibility-docusign.md` (webhook endpoints sketch, status machine integration points)

**Definition of Done**: Perf targets demonstrated in tests; runbooks written; DocuSign extensibility documented.
**Timebox**: ≤2–3 days
**Progress checklist**

* [ ] Perf tests + results documented
* [ ] Failure injection scenarios covered
* [ ] Runbooks and rollback plan ready
* [ ] DocuSign hooks modeled (no implementation)
  **PR checklist**
* [ ] Tests cover external behaviour and edge cases
* [ ] Security & secrets handled per policy
* [ ] Observability (logs/metrics/traces) added where relevant
* [ ] Docs updated (README/Runbook/ADR)
* [ ] Reviewer notes: risks, roll-back, toggles

---

## GLOBAL NOTES (apply while executing tasks)

* **Global test stack (mandatory)**:

  * Node/Fastify: **Jest + ts‑jest + Supertest + Nock**.
  * Salesforce: **Apex `@isTest`** with **`HttpCalloutMock`**.
  * Assert **observables** only: HTTP status/payload, SF record mutations/links, idempotency, metrics.
* **Hard constraints (enforced throughout)**:

  * Runtime: Node.js, TypeScript + Fastify; single container runs API + internal poller.
  * LibreOffice via `soffice --headless`; base image `debian:bookworm-slim`.
  * ACA sizing: 2 vCPU / 4 GB; **max concurrent doc jobs per instance: 8**; temp dir `/tmp`; Region **UK South**.
  * Inbound auth: AAD OAuth2 **client credentials** (Salesforce Named Credential).
  * Outbound auth: Node → Salesforce **JWT Bearer Flow** (Integration User).
  * Templates: Salesforce Files (**ContentVersion**) on **Docgen Template** object.
  * **Node does not execute SOQL for template data**; Apex builds the JSON envelope.
  * Interactive flow: **LWC → Apex (@AuraEnabled) → Node**; upload-first; return **ContentVersion** URL.
  * Batch flow: Apex Batch/Queueable populates rows; ACA poller processes.
  * Idempotency: `RequestHash` External ID from `{templateId, data checksum, output format}`.
  * Poller: every **15s**, fetch **50**, **concurrency=8**, **lock TTL=2m**; Retry: **max 3** with **1m/5m/15m** backoff.
  * Retention/caching: store full `RequestJSON__c`; template cache **immutable** by ContentVersionId; images base64 preferred with allowlist for https; bundle corporate fonts.
  * File persistence & linking: store PDF always; optional merged DOCX; link file to all present parent IDs.
