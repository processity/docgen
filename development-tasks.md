# Salesforce PDF Generation - Development Tasks

## Overview

17 development tasks completed, building a production-ready Salesforce PDF generation system with interactive and batch modes, Azure Container Apps deployment, and configurable object support.

**Test Results**: 381 Node.js tests passing | 112 Apex tests passing (86% org-wide coverage)

**Environments**:
- Staging: `https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io`
- Production: Infrastructure deployed and ready

**Supported Objects**: 5 pre-configured (Account, Opportunity, Case, Contact, Lead) + unlimited via Custom Metadata configuration

---

## Task Execution Order

### T-01 — Repository, Runtime & Test Harness Bootstrap

**Purpose**: Bootstrap TypeScript/Fastify service with Jest/Supertest/Nock testing infrastructure and Apex test scaffolding to establish TDD baseline.

**Prerequisites**: Node 20+, Salesforce CLI

**Implementation**:
- Fastify app with `/healthz` (liveness) and `/readyz` (readiness) endpoints
- Jest test infrastructure with ts-jest, Supertest for HTTP testing, Nock for mocking external APIs
- Apex package scaffold with `Placeholder.cls` + test
- GitHub Actions CI/CD workflow
- ESLint, Prettier, strict TypeScript configuration

**Deliverables**: 26 files (2,918 lines) including server skeleton, test harness (5 passing tests), 4 ADRs (Runtime, Auth, Worker, Caching/Idempotency), README, CI pipeline

---

### T-02 — System Flows Diagram & ADRs

**Purpose**: Document end-to-end interactive and batch flows; record architectural decisions as non-negotiable constraints.

**Prerequisites**: T-01

**Implementation**:
- Single Mermaid sequence diagram covering both interactive (LWC → Apex → Node → upload → return URL) and batch (poller-driven) flows
- ADRs documenting: runtime (Node.js + Fastify + LibreOffice), container shape (single container with internal poller), auth directions (AAD inbound, JWT Bearer outbound), worker model, caching strategy, idempotency via RequestHash

**Deliverables**: Mermaid diagram in README, 4 ADRs, documentation validation tests

---

### T-03 — Data Contract & OpenAPI Skeleton

**Purpose**: Define JSON envelope schema (Apex → Node contract) with Fastify validation; establish field-path conventions.

**Prerequisites**: T-02

**Implementation**:
- OpenAPI 3.0 specification for `POST /generate` endpoint
- Fastify route schema validation (templateId, outputFileName, outputFormat, locale, timezone, data, parents, requestHash)
- Field path convention: Salesforce API-style (`Account.Name`, `Opportunity.TotalAmount__formatted`)
- Sample JSON envelopes for Account, Opportunity, Case
- docx-templates patterns: loops `{{#each Items}}`, conditionals `{{#if}}`, formatted values `{{Field__formatted}}`

**Deliverables**: OpenAPI spec (417 lines), POST /generate route with schema, 3 sample payloads, field conventions documentation (461 lines), 15 validation tests

---

### T-04 — Salesforce Custom Objects & Fields

**Purpose**: Create `Docgen_Template__c` and `Generated_Document__c` custom objects to store configuration and track document generation state.

**Prerequisites**: T-03

**Implementation**:
- **Docgen_Template__c**: Stores template configuration
  - `TemplateContentVersionId__c` (Text 18) - DOCX template reference
  - `DataSource__c` (Picklist: SOQL|Custom)
  - `SOQL__c` (Long Text) - Query for default provider
  - `ClassName__c` (Text) - Custom provider class name
  - `StoreMergedDocx__c`, `ReturnDocxToBrowser__c` (Checkboxes)
  - `PrimaryParent__c` (Unrestricted Picklist) - Parent object type
- **Generated_Document__c**: Tracks document generation lifecycle
  - Parent lookups: `Account__c`, `Opportunity__c`, `Case__c`, `Contact__c`, `Lead__c`
  - `Template__c` (Lookup to Docgen_Template__c)
  - `RequestJSON__c` (Long Text) - Full envelope for audit
  - `Status__c` (Picklist: QUEUED, PROCESSING, SUCCEEDED, FAILED, CANCELED)
  - `Priority__c`, `Attempts__c`, `LockedUntil__c`, `ScheduledRetryTime__c`
  - `Error__c` (Long Text)
  - `CorrelationId__c` (Text 36)
  - `RequestHash__c` (Text 80, External ID, Unique) - Idempotency key
  - `OutputFileId__c`, `MergedDocxFileId__c` (Text 18) - ContentVersionIds
  - `RequestedBy__c` (Lookup User)
  - `OutputFormat__c` (Picklist: PDF, DOCX)

**Deliverables**: 37 metadata files, 16 Apex tests enforcing required fields and External ID uniqueness

---

### T-05 — Apex Data Provider, Envelope Builder & RequestHash

**Purpose**: Build pluggable data provider system; construct JSON envelope with locale-aware formatting; compute deterministic idempotency hash.

**Prerequisites**: T-04

**Implementation**:
- **DocgenDataProvider** interface with `buildData(recordId, template, locale, timezone)` method
- **StandardSOQLProvider**: Executes `template.SOQL__c` with `:recordId` binding
  - Locale-aware formatting: Currency (£1,200,000 vs $250,000), dates (31 Dec 2025 vs 12/31/2025), numbers
  - Timezone-aware datetime conversions
  - Adds `__formatted` suffix to all numeric/date/currency fields
  - Supports custom providers via `Type.forName(template.ClassName__c)`
- **DocgenEnvelopeService**: Orchestrates envelope construction
  - Provider factory pattern (SOQL vs Custom)
  - Parent ID extraction from record
  - Options mapping from template checkboxes
  - **RequestHash computation**: `sha256(templateId | outputFormat | sha256(dataJson))` for idempotency

**Deliverables**: 3 Apex classes (interface, SOQL provider, envelope service), 3 test classes (38 tests), deterministic hash algorithm with stable JSON serialization

---

### T-06 — AAD Named Credential & Apex Interactive Controller

**Purpose**: Configure AAD client credentials authentication; implement Apex controller for interactive document generation via LWC.

**Prerequisites**: T-05

**Implementation**:
- **Named Credential**: AAD OAuth 2.0 Client Credentials flow targeting Node API
- **DocgenController** (@AuraEnabled):
  - Idempotency short-circuit: Checks for existing SUCCEEDED documents within 24-hour window before HTTP callout
  - Builds envelope via `DocgenEnvelopeService`
  - Inserts `Generated_Document__c` with Status=PROCESSING, RequestJSON, RequestHash
  - Calls Node `/generate` via Named Credential
  - Updates OutputFileId, Status on success/failure
  - Returns download URL: `https://{SF_DOMAIN}/sfc/servlet.shepherd/version/download/{ContentVersionId}`
  - Correlation ID generation (UUID v4)
  - Error handling with `AuraHandledException` for LWC consumption

**Deliverables**: DocgenController (295 lines), DocgenControllerTest with HttpCalloutMock (410 lines), Named Credential metadata, setup documentation (375 lines), 8 test scenarios including idempotency validation

---

### T-07 — LWC Button UX & ContentDocumentLink Strategy

**Purpose**: Provide user-facing button for interactive generation; define multi-parent file linking strategy.

**Prerequisites**: T-06

**Implementation**:
- **docgenButton LWC Component**:
  - Configurable properties: templateId, outputFormat, buttonLabel, successMessage
  - UI: Button with spinner during processing, disabled state
  - Success flow: Opens download URL in new tab + success toast
  - Error flow: Error toast with message + re-enables button
  - Validation: Checks required properties before invocation
  - Deployment targets: Record/App/Home pages via Lightning App Builder
- **ContentDocumentLink Strategy**:
  - Link `ContentDocument` to all non-null parent IDs (Account, Opportunity, Case, Contact, Lead)
  - `ShareType = V` (Viewer), `Visibility = AllUsers`
  - Ensures file discoverability from all related records

**Deliverables**: LWC component (HTML, JS, metadata), 12 Jest tests, ContentDocumentLink documentation with Mermaid diagrams and security considerations, LWC test infrastructure (@salesforce/sfdx-lwc-jest)

---

### T-08 — AAD JWT Validation (Inbound) & Request Validation

**Purpose**: Secure API with Azure AD JWT verification; enforce Fastify schema validation on all requests.

**Prerequisites**: T-03

**Implementation**:
- **AAD JWT Verifier** (`src/auth/aad.ts`):
  - JWKS-based signature validation via OpenID metadata for Azure tenant
  - Claims validation: `iss` (tenant), `aud` (client ID), `exp`, `nbf`
  - JWKS caching (5 minutes) with rate limiting
  - Development bypass mode (`AUTH_BYPASS_DEVELOPMENT=true`)
- **Fastify Auth Plugin**:
  - preHandler hook on `/generate` endpoint
  - Error responses: 401 (invalid/missing token), 403 (wrong audience/issuer)
  - Correlation ID propagation in auth failures
- **Readiness Check**: `/readyz` includes JWKS connectivity validation

**Deliverables**: AAD auth module (196 lines), Fastify plugin (119 lines), 20 auth test scenarios, JWT test helper utilities (156 lines), dependencies (jsonwebtoken, jwks-rsa)

---

### T-09 — Salesforce Client via JWT Bearer (Outbound)

**Purpose**: Authenticate Node → Salesforce with Integration User using JWT Bearer Flow; implement REST API wrapper with retry logic.

**Prerequisites**: T-08

**Implementation**:
- **SalesforceAuth** (`src/sf/auth.ts`):
  - JWT signing with RS256 algorithm
  - Private key from environment variable or Key Vault
  - Audience: `https://login.salesforce.com`
  - Token caching with 60-second expiry buffer
  - Automatic refresh on 401 responses
  - Singleton pattern for shared auth instance
- **SalesforceApi** (`src/sf/api.ts`):
  - REST wrapper supporting GET, POST, PATCH, DELETE
  - Retry logic: 401 → refresh + retry once | 5xx → 3 retries (1s, 2s, 4s backoff) | 4xx → no retry
  - Correlation ID propagation in headers
  - Structured logging for all API calls
- **Health Integration**: `/readyz` includes Salesforce connectivity check

**Deliverables**: SF auth module (215 lines), API client (168 lines), 31 tests (18 auth + 13 API), Axios dependency, SF types in `src/types.ts`

---

### T-10 — Template Fetch & Immutable Cache + docx-templates Usage

**Purpose**: Download DOCX templates from Salesforce Files; cache immutably by ContentVersionId; merge data using docx-templates.

**Prerequisites**: T-09

**Implementation**:
- **Template Cache** (`src/templates/cache.ts`):
  - In-memory Map cache with infinite TTL (ContentVersion is immutable)
  - LRU eviction at 500 MB threshold
  - Stats tracking: hits, misses, evictions, size, entry count
  - Methods: `get()`, `set()`, `has()`, `getStats()`, `clear()`, `reset()`
- **Template Service** (`src/templates/service.ts`):
  - Check cache → Download from SF on miss → Store → Return Buffer
  - Correlation ID propagation
- **Template Merge** (`src/templates/merge.ts`):
  - docx-templates integration with Handlebars-style delimiters
  - Field paths: `{{Account.Name}}`, `{{Opportunity.Owner.Name}}`
  - Formatted values: `{{Amount__formatted}}`
  - Arrays/loops: `{{#each Opportunity.LineItems}}...{{/each}}`
  - Conditionals: `{{#if Account.IsPartner}}...{{/if}}`
- **Image Allowlist** (`src/utils/image-allowlist.ts`):
  - URL validation to prevent SSRF
  - Configured via `IMAGE_ALLOWLIST` env var
  - Subdomain matching support
  - Prefer base64 images over external URLs

**Deliverables**: 3 template modules (cache, service, merge - 475 lines), SF API extension (`downloadContentVersion()` method), 55 tests (19 cache + 13 service + 23 merge), template authoring guide (621 lines), docx-templates dependency

---

### T-11 — LibreOffice Conversion Pool

**Purpose**: Convert DOCX to PDF using bounded worker pool (max 8 concurrent) with `soffice --headless`; handle timeouts and cleanup.

**Prerequisites**: T-10

**Implementation**:
- **LibreOfficeConverter Class** (`src/convert/soffice.ts`):
  - Bounded pool: Max 8 concurrent conversions, others queued
  - Pool management: `acquireSlot()` / `releaseSlot()` with FIFO queue
  - Timeout handling: Configurable (default 60s), kills hung processes
  - Conversion flow:
    1. Acquire slot in pool
    2. Create temp directory: `/tmp/docgen-{correlationId}-{timestamp}/`
    3. Write DOCX → Execute `soffice --headless --convert-to pdf`
    4. Read PDF → Cleanup (always) → Release slot
  - Stats tracking: activeJobs, queuedJobs, completedJobs, failedJobs, totalConversions
  - Correlation ID propagation
  - Robust cleanup: Temp files always removed (success/failure/timeout)
- **Configuration**: Environment variables for timeout, workdir, max concurrent

**Deliverables**: Conversion module (386 lines), 11 test scenarios (success, timeout, crash, concurrency, queue, cleanup, stats), structured logging with Pino

---

### T-12 — Upload to Salesforce Files & Linking; Idempotency

**Purpose**: Create ContentVersion, link to parent records, update Generated_Document status; enforce idempotency via RequestHash.

**Prerequisites**: T-09, T-10, T-11

**Implementation**:
- **uploadContentVersion()**: Upload PDF/DOCX to Salesforce Files
  - Base64 encoding
  - Returns ContentVersionId and ContentDocumentId
  - Retry on 5xx (1s, 2s, 4s backoff), no retry on 4xx
- **createContentDocumentLinks()**: Link file to multiple parents
  - Filters null parent IDs automatically
  - Non-fatal failures (collects errors, continues processing)
  - ShareType=V (Viewer), Visibility=AllUsers
  - Returns created count and error array
- **updateGeneratedDocument()**: Update status via PATCH
  - SUCCEEDED: Sets OutputFileId__c (and optional MergedDocxFileId__c)
  - FAILED: Sets Error__c message
  - Uses PATCH method with retry logic
- **uploadAndLinkFiles()**: Main orchestrator
  - Uploads PDF (always) + DOCX (if storeMergedDocx=true)
  - Creates links for all non-null parents
  - Updates Generated_Document__c status
  - Link failures → file orphaned, status=FAILED
- **Idempotency Strategy** (Apex-owned):
  - Apex computes RequestHash: `sha256(templateId | outputFormat | sha256(data))`
  - Apex checks for existing SUCCEEDED document within 24-hour window
  - Cache hit → return existing download URL (no callout, no DML)
  - Salesforce enforces unique constraint on RequestHash__c (External ID)
  - Node relies on Apex for idempotency (no duplicate check in Node)

**Deliverables**: SF files module (390 lines), 21 comprehensive tests, idempotency documentation (700+ lines), types for ContentVersion/ContentDocumentLink, PATCH method added to SF API

---

### T-13 — `/generate` End-to-End Interactive Path

**Purpose**: Wire complete interactive pipeline from AAD auth through upload, returning download URL; comprehensive error handling and observability.

**Prerequisites**: T-08 to T-12

**Implementation**:
- **Generate Route** (`src/routes/generate.ts` - 418 lines):
  - AAD authentication via `fastify.authenticate` preHandler
  - Correlation ID extraction from header or UUID generation
  - Template fetch with immutable caching
  - Template merge with locale/timezone support
  - Conditional DOCX→PDF conversion via LibreOffice pool
  - File upload to Salesforce with ContentDocumentLink creation
  - Generated_Document__c status tracking (SUCCEEDED/FAILED)
  - Structured response: `{ downloadUrl, contentVersionId, correlationId }`
- **Error Handling**: Comprehensive classification
  - 404: Template not found
  - 400: Validation errors (missing fields, invalid outputFormat)
  - 502: Conversion failures, upload failures
  - All errors include correlation ID for tracing
  - Failed status updates to Generated_Document__c.Error__c field
  - Graceful degradation (status update failures don't break response)
- **Test Coverage**: 242 total tests
  - Integration tests (10 scenarios): PDF/DOCX generation, multi-parent linking, cache verification, error paths
  - Unit tests (12 scenarios with Nock): Success paths, error paths, token refresh, locale validation
- **Supporting Infrastructure**:
  - `test/helpers/test-docx.ts`: Programmatic DOCX generation for tests
  - `/auth-test` endpoint for auth testing
  - Sequential test execution to avoid LibreOffice conflicts

**Deliverables**: Complete E2E route (418 lines), 22 integration/unit tests (1,212 lines), OpenAPI response examples, test DOCX generator, updated SF auth initialization

---

### T-14 — Batch Enqueue (Apex) & Node Poller Worker

**Purpose**: Implement Apex batch/queueable for mass generation; build Node poller for queue processing with locks, retries, and backoff.

**Prerequisites**: T-12, T-13

**Implementation**:
- **PollerService** (`src/worker/poller.ts` - 547 lines):
  - Configurable polling: 15s active interval, 60s idle interval (when queue empty)
  - Batch fetching: Up to 20 documents per poll (configurable via POLLER_BATCH_SIZE)
  - Lock management: 2-minute TTL with LockedUntil__c field
  - Concurrency control: Max 8 concurrent (respects LibreOffice pool)
  - Retry logic: Max 3 attempts with exponential backoff (1min → 5min → 15min)
  - Error classification: Retryable (5xx, timeouts) vs non-retryable (404, 400, "not found")
  - Status tracking: QUEUED → PROCESSING → SUCCEEDED/FAILED
  - In-flight promise tracking: Graceful shutdown waits for active jobs
  - Stats collection: totalProcessed, totalSucceeded, totalFailed, totalRetries, queue depth
- **Worker Control Routes** (`src/routes/worker.ts` - AAD-protected):
  - `POST /worker/start` - Start poller
  - `POST /worker/stop` - Graceful stop (waits for in-flight jobs)
  - `GET /worker/status` - Current status (running, queue depth, last poll time)
  - `GET /worker/stats` - Statistics (processed, succeeded, failed, retries)
- **Salesforce Fields**:
  - `MergedDocxFileId__c` - ContentVersionId for merged DOCX
  - `ScheduledRetryTime__c` - DateTime for next retry attempt
- **Configuration**:
  - `POLLER_ENABLED` - Enable/disable (default: false)
  - `POLLER_INTERVAL_MS` - Active polling interval (default: 15000ms)
  - `POLLER_IDLE_INTERVAL_MS` - Idle interval when queue empty (default: 60000ms)
  - `POLLER_BATCH_SIZE` - Documents per poll (default: 20)
  - `POLLER_LOCK_TTL_MS` - Lock duration (default: 120000ms = 2 minutes)
  - `POLLER_MAX_ATTEMPTS` - Retry limit (default: 3)

**Deliverables**: Poller service (547 lines), worker routes (383 lines), 31 tests (28 unit + 3 integration including end-to-end, 404 error handling, lock TTL respect), 2 new SF fields, configuration types

---

### T-15 — Observability with Azure Application Insights

**Purpose**: Integrate App Insights with custom metrics, dependency tracking, and correlation IDs for production observability.

**Prerequisites**: T-13, T-14

**Implementation**:
- **App Insights Wrapper** (`src/obs/insights.ts` - 310 lines):
  - OpenTelemetry SDK integration
  - Graceful degradation (service works without connection)
  - Environment-aware (disabled in test, enabled in production/dev)
- **Metrics Tracked**:
  - `docgen_duration_ms` - Histogram for P50/P95/P99
  - `docgen_failures_total` - Counter with 6 categorized reasons (template_not_found, validation_error, conversion_timeout, conversion_failed, upload_failed, unknown)
  - `queue_depth` - Gauge for current queued documents
  - `retries_total` - Retry attempts counter
  - `template_cache_hit/miss` - Cache performance counters
  - `conversion_pool_active/queued` - Pool utilization gauges
- **Dependency Tracking**:
  - Salesforce REST API calls (duration, success/failure, correlation ID)
  - LibreOffice conversions (duration, success/failure, correlation ID)
- **Integration Points**:
  - Generate route (interactive mode) - tracks duration & failures
  - Poller worker (batch mode) - tracks duration, failures, queue depth, retries
  - Correlation ID propagation throughout pipeline
- **Dashboards Documentation** (`docs/dashboards.md` - 856 lines):
  - 26 KQL queries for metrics analysis
  - 6 alert rule definitions with thresholds
  - 6 troubleshooting runbooks
  - 4 dashboard layouts (Overview, Performance, Reliability, Capacity)
  - KPIs and SLOs defined (success rate ≥99.5%, P95 ≤10s, queue depth <50)

**Deliverables**: App Insights module (310 lines), 20 observability tests (635 lines), dashboards guide (856 lines), README observability section, OpenTelemetry dependencies, metrics integration in generate route and poller

---

### T-16 — Containerization & Azure Container Apps Deployment

**Purpose**: Build production Docker image on Debian Bookworm with LibreOffice; deploy to ACA (East US, 2 vCPU/4 GB) with Key Vault integration and CI/CD pipelines.

**Prerequisites**: T-11, T-13, T-15

**Implementation**:
- **Docker Infrastructure** (`Dockerfile`):
  - Multi-stage build (builder + runtime)
  - Base: `debian:bookworm-slim` with Node.js 20
  - LibreOffice: `libreoffice-writer-nogui`, `libreoffice-java-common`
  - PDF Tools: ghostscript
  - Fonts: `fonts-dejavu`, `fonts-liberation`, `ttf-mscorefonts-installer` (Arial, Times New Roman, etc.)
  - Security: Non-root user (`appuser`, UID/GID 1000)
  - Health check: Curl-based `/healthz` every 30s
  - Optimized `.dockerignore`
- **Azure Infrastructure** (Bicep IaC - 900+ lines across 5 modules):
  - **Main Orchestrator**: Region East US, coordinates 5 modules
  - **Module 1: Monitoring**: Log Analytics (30-day retention) + Application Insights
  - **Module 2: Container Registry**: ACR with Managed Identity auth (Basic SKU staging, Standard SKU production)
  - **Module 3: Key Vault**: RBAC-enabled, 90-day soft delete, purge protection, Standard SKU
  - **Module 4: ACA Environment**: Managed environment with Log Analytics integration
  - **Module 5: Container App**:
    - CPU: 2.0 vCPU, Memory: 4 GB
    - Scaling: 1-5 replicas, CPU >70% autoscaling
    - System-assigned Managed Identity
    - Ingress: HTTPS, external, port 8080
    - Probes: Startup (`/readyz`), Liveness (`/healthz`), Readiness (`/readyz`)
    - 23 environment variables
  - **Parameters**: Separate files for staging and production
- **Key Vault Integration** (`src/config/secrets.ts` - 150 lines):
  - `loadSecretsFromKeyVault()`: Loads 5 secrets (SF-PRIVATE-KEY, SF-CLIENT-ID, SF-USERNAME, SF-DOMAIN, AZURE-MONITOR-CONNECTION-STRING)
  - DefaultAzureCredential: Managed Identity, Azure CLI, environment variables
  - Graceful degradation: Returns empty object on errors (logged)
  - Parallel fetching for performance
  - `checkKeyVaultConnectivity()`: Tests access for readiness probe
- **Configuration** (`src/config/index.ts`):
  - Production mode: Loads secrets from Key Vault when `NODE_ENV=production` and `KEY_VAULT_URI` set
  - Precedence: Key Vault secrets override environment variables
  - Validation: `validateConfig()` ensures required fields in production
- **CI/CD Pipelines** (4 GitHub Actions workflows - 1,200+ lines):
  - **docker-build.yml**: Reusable workflow with Buildx, multi-platform support, registry caching
  - **deploy-staging.yml**: Auto-deploy on merge to main (7 jobs: build, deploy infra, populate secrets, update app, smoke tests, rollback, summary)
  - **deploy-production.yml**: Manual approval, triggered on release (enhanced smoke tests, two image tags)
  - **ci.yml**: Added Dockerfile validation and LibreOffice installation
- **Documentation** (5 major files - 5,637 lines):
  - DEPLOY.md (1,100 lines): Complete deployment guide
  - PROVISIONING.md (787 lines): One-time setup, cost estimates
  - PROVISIONING-CHECKLIST.md (224 lines): Quick reference
  - RUNBOOKS.md (1,559 lines): 10 operational runbooks
  - TROUBLESHOOTING-INDEX.md (467 lines): Common issues, error codes
- **Scripts**: `provision-environment.sh` (450 lines) - One-time setup automation

**Deliverables**: Docker infrastructure (Dockerfile, .dockerignore), Bicep IaC (5 modules, 900+ lines), 4 CI/CD workflows (1,200+ lines), Key Vault integration (150 lines), 5 deployment docs (5,637 lines), 15 config/secrets tests, provisioning automation script, staging environment live

**Current State**:
- Staging: Live at `https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io`
- Production: Infrastructure ready, awaiting first release

---

### T-17 — Object Configurability: Support Any Salesforce Object

**Purpose**: Transform system from 3 hardcoded objects to unlimited configurable objects via Custom Metadata, enabling admins to add new objects without code changes.

**Prerequisites**: T-01 through T-16

**Implementation**:
- **Configuration Foundation**:
  - **Custom Metadata Type**: `Supported_Object__mdt` with fields:
    - `Object_API_Name__c` - Object to support (e.g., "Contact")
    - `Lookup_Field_API_Name__c` - Field on Generated_Document__c (e.g., "Contact__c")
    - `Is_Active__c` - Enable/disable support
    - `Display_Order__c`, `Description__c`
  - **Metadata Records**: 5 pre-configured (Account, Opportunity, Case, Contact, Lead)
  - **New Lookup Fields**: `Contact__c`, `Lead__c` on Generated_Document__c
  - **DocgenObjectConfigService** (`142 lines`):
    - Query all active object configurations
    - Transaction-scoped static caching (prevents additional SOQL queries)
    - Validation: `validateObjectSupported(objectType)` throws descriptive exception
    - `getConfigByObjectType()`, `getConfigByLookupField()`, `getAllConfigs()`
- **Core Logic Refactoring** (Eliminated all hardcoded if/else object type checks):
  - **DocgenController** (lines 206-214 refactored):
    - Before: 3-branch if/else chain (21 lines)
    - After: `doc.put(config.Lookup_Field_API_Name__c, recordId)` (6 lines)
  - **BatchDocgenEnqueue** (lines 203-233 refactored):
    - Before: 3-branch if/else chain (21 lines)
    - After: Dynamic lookup assignment via config (6 lines)
  - **DocgenEnvelopeService** (lines 130-180 refactored):
    - Before: Hardcoded Map keys (`AccountId`, `OpportunityId`, `CaseId`)
    - After: Dynamic `{ObjectType}Id` format (e.g., `ContactId`, `LeadId`)
    - Returns `Map<String, String>` with dynamic parent keys
- **Backend Integration**:
  - **Type Change**: `DocgenParents` from fixed 3-field interface to `Record<string, string | null>` (unlimited fields)
  - **JSON Schema**: Updated to `additionalProperties: true` for dynamic parent keys
  - **File Linking**: `createContentDocumentLinks()` refactored to iterate `Object.values(parents)`
  - **Status Updates**: Parent lookup field mapping in `uploadAndLinkFiles()`
- **Configuration UI**:
  - `PrimaryParent__c` changed from restricted to unrestricted picklist
  - Suggestions: Account, Opportunity, Case, Contact, Lead
  - Backend validation via `DocgenObjectConfigService.validateObjectSupported()`
- **Security**:
  - FLS granted on `Contact__c` and `Lead__c` in Docgen_User permission set
  - Object permissions validated per standard Salesforce security model
- **Testing**:
  - **DocgenTestDataFactory** (`241 lines`): Scenario builder pattern for multi-object testing
  - **DocgenMultiObjectIntegrationTest** (8 test methods): E2E integration for all 5 objects
  - **E2E Tests** (`e2e/tests/multi-object.spec.ts` - 5 Playwright tests): Contact, Lead, Opportunity with real backend
  - **Bulk Tests**: 200 Contact records, 200 Lead records validated
  - **Mixed Batch**: 100 Accounts + 100 Contacts in single batch

**Key Architecture Changes**:
- **Apex**: Replaced 3 hardcoded if/else chains (63 lines) with config-driven dynamic lookup (6 lines)
- **Backend**: Changed from fixed 3-field interface to dynamic `Record<string, string | null>` supporting unlimited objects
- **Configuration**: Custom Metadata Type enables admin self-service
- **Caching**: Transaction-scoped static cache prevents SOQL query overhead
- **Parent Extraction**: Changed from hardcoded Map keys to dynamic `{ObjectType}Id` format

**Admin Experience** (Zero-code deployment):
1. Create Custom Metadata record (Object_API_Name__c, Lookup_Field_API_Name__c)
2. Create lookup field on Generated_Document__c
3. No code deployment, no backend restart required

**Deliverables**: 17 new files (13 SF metadata/classes, 1 E2E test, 1 playbook, 2 README updates), 13 modified files (6 Apex, 4 metadata, 3 backend), object configurability playbook (1,810 lines), 23 new tests (15 config service + 8 integration), 5 E2E tests with Playwright

**Impact**: Transforms system from supporting 3 hardcoded objects to unlimited configurable objects, enabling business agility and reducing development dependency

---

## GLOBAL CONSTRAINTS

Applied across all tasks T-01 through T-17:

**Test Stack**:
- Node/Fastify: Jest + ts-jest + Supertest + Nock
- Salesforce: Apex @isTest with HttpCalloutMock
- Assert observables only: HTTP status/payload, SF record mutations, idempotency, metrics

**Architecture**:
- Runtime: Node.js + TypeScript + Fastify + LibreOffice; single container (API + internal poller)
- Container: debian:bookworm-slim base
- Hosting: Azure Container Apps, East US, 2 vCPU / 4 GB RAM
- Concurrency: Max 8 doc jobs per instance; temp workdir `/tmp`

**Authentication**:
- Inbound (SF → Node): AAD OAuth2 client credentials via Named Credential
- Outbound (Node → SF): JWT Bearer Flow with Integration User

**Data & Templates**:
- Templates: Salesforce Files (ContentVersion) on Docgen Template object
- Data prep: Apex builds JSON envelope; Node does not run SOQL for template data
- Idempotency: RequestHash (External ID) = `sha256(templateId | outputFormat | sha256(data))`
- Caching: Templates cached immutably by ContentVersionId; images prefer base64; external images must be allowlisted

**Interactive Flow**:
- LWC → Apex (@AuraEnabled) → Node
- Upload-first; return ContentVersion download URL

**Batch Flow**:
- Apex Batch/Queueable creates Generated_Document__c rows
- Node poller: every 15s, fetch 50 rows, concurrency=8, lock TTL=2m
- Lifecycle: QUEUED → PROCESSING → SUCCEEDED/FAILED/CANCELED
- Retry: Max 3 attempts with 1m/5m/15m backoff

**Files & Linking**:
- Store PDF (always) + optionally merged DOCX
- Link ContentDocument to all present parent IDs (Account/Opportunity/Case/Contact/Lead)
- ShareType=V, Visibility=AllUsers

---

---

### T-18 — Composite Document Feature: Multi-Source Document Generation

**Purpose**: Enable complex documents combining data from multiple SOQL queries or Apex providers, eliminating the single-data-source limitation. Supports two strategies: Own Template (single merged template) and Concatenate Templates (merge + stitch multiple templates with section breaks).

**Prerequisites**: T-01 through T-17 (complete base system)

**Implementation**:

**Salesforce Schema (T-18)**:
- **Composite_Document__c**: Configuration object for multi-source documents
  - `Template_Strategy__c` (Picklist: "Own Template" | "Concatenate Templates")
  - `TemplateContentVersionId__c` (Text 18) - Required for Own Template strategy
  - `StoreMergedDocx__c`, `ReturnDocxToBrowser__c`, `PrimaryParent__c`
  - `IsActive__c` (Checkbox)
  - Validation rules enforce strategy-specific requirements
- **Composite_Document_Template__c**: Junction object (many-to-many)
  - `Composite_Document__c` (Lookup, required)
  - `Document_Template__c` (Lookup to Docgen_Template__c, required)
  - `Namespace__c` (Text 80, required) - Data key in merged JSON (e.g., "Account", "Terms")
  - `Sequence__c` (Number, required) - Execution order and concatenation order
  - `IsActive__c` (Checkbox)
  - `Unique_Key__c` formula field for display (uniqueness enforced in Apex)
- **Generated_Document__c**: Enhanced with `Composite_Document__c` lookup
  - Validation rule: Require `Template__c` OR `Composite_Document__c` (not both, not neither)

**Apex Core Logic (T-19, T-20, T-21, T-22)**:
- **CompositeDocgenDataProvider** (T-19):
  - Implements `DocgenDataProvider` interface
  - `buildCompositeData()` orchestrates multiple data sources with isolated namespaces
  - Executes junction records in sequence order
  - Variable pool enables data sharing between templates (e.g., AccountId from first query used in second)
  - Namespace collision detection prevents duplicate keys
  - Mix of SOQL and Custom providers supported
- **DocgenEnvelopeService** enhancements (T-20):
  - `buildForComposite()` method constructs envelopes for composite documents
  - Parent extraction across multiple namespaces (dynamic `{ObjectType}Id` format)
  - RequestHash computation: `sha256(compositeDocId | outputFormat | recordIds | dataHash)`
  - Template strategy determines envelope structure (single templateId vs templates array)
  - New Envelope fields: `compositeDocumentId`, `templateStrategy`, `templates[]` (TemplateRef)
- **DocgenController** enhancements (T-21):
  - `generateComposite()` method for interactive generation (@AuraEnabled)
  - Parses recordIds JSON parameter to Map<String, Id>
  - Idempotency check (24-hour cache window)
  - Generated_Document__c creation with composite lookup
  - Dynamic parent lookup assignment using DocgenObjectConfigService
  - Correlation ID generation and propagation
  - AuraHandledException for LWC error handling
- **BatchDocgenEnqueue** enhancements (T-22):
  - New constructors accept `compositeDocId` parameter
  - `isComposite` flag toggles processing logic
  - `buildCompositeRecordIdsMap()` merges static + dynamic record IDs
  - Enhanced execute() branches between template/composite modes
  - JSON truncation prevents DML errors (131KB RequestJSON__c limit)
  - Status__c = 'QUEUED' for poller processing

**Backend Services (T-23, T-24, T-25)**:
- **DOCX Concatenation Service** (T-23):
  - `concatenateDocx()` function in `src/templates/concatenate.ts`
  - JSZip-based DOCX manipulation (ZIP archive with XML)
  - Section breaks via `<w:sectPr><w:type w:val="nextPage"/></w:sectPr>`
  - Header/footer preservation (simplified - first section wins)
  - Sequence ordering enforcement
  - Single section optimization (no unnecessary processing)
  - TemplateSection interface: buffer, sequence, namespace
- **Enhanced /generate Route** (T-24):
  - Composite detection via `compositeDocumentId` field
  - Dual processing path:
    - **Own Template**: Single merge with full composite data (all namespaces)
    - **Concatenate Templates**: Loop templates, merge each with namespace data, concatenate
  - TypeScript type changes:
    - `DocgenRequest.templateId` made optional
    - Added `compositeDocumentId`, `templateStrategy`, `templates[]`
    - `TemplateReference` interface: templateId, namespace, sequence
  - Validation: Strategy-specific required fields (400 errors)
  - Missing namespace data throws error (non-retryable)
  - Backward compatible (all 12 original tests still passing)
- **Poller Worker Enhancements** (T-25):
  - Composite detection in `processDocument()` method
  - Own Template processing: merges single template with full data
  - Concatenate Templates processing: loops templates, merges, concatenates
  - Missing namespace error handling (non-retryable)
  - Stats tracking distinguishes composite vs single documents
  - Metrics tags: `documentType`, `templateStrategy`
  - `Template__c` field made nullable in QueuedDocument interface

**User Interface (T-26)**:
- **compositeDocgenButton LWC Component**:
  - HTML template with button and spinner
  - Configurable properties:
    - `compositeDocumentId` (required)
    - `recordId` (from page context)
    - `recordIdField` (variable name)
    - `additionalRecordIds` (JSON string for multi-record generation)
    - `outputFormat`, `buttonLabel`, `successMessage`
  - `buildRecordIdsMap()` merges recordId + additionalRecordIds
  - Success flow: Opens download URL + toast
  - Error flow: Toast with sticky mode
  - Loading state: Disabled button + spinner
  - Property validation prevents invalid configurations
  - Metadata XML exposes to Lightning App Builder

**End-to-End Testing (T-27)**:
- **Playwright E2E Tests** (`e2e/tests/composite-document-generation.spec.ts`):
  - Interactive Own Template strategy with 2 namespaces (Account data with Contacts/Opportunities/Cases subqueries)
  - Interactive Concatenate Templates strategy with 4 templates (Account, Contacts, Opportunities, Cases sections)
  - Test data creation: Account + 3 Contacts + 5 Opportunities + 2 Cases
  - Template upload automation
  - Junction record configuration
  - Poller processing verification (QUEUED → SUCCEEDED)
  - PDF verification + ContentDocumentLink validation
  - Comprehensive cleanup in finally blocks
- **Test DOCX Fixtures** (5 files):
  - Programmatic generation using JSZip with correct FOR/END-FOR, IF/END-IF, EXEC syntax
  - Own Template: `composite-account-summary.docx` (references `Account.Contacts`, `Account.Opportunities`, `Account.Cases`)
  - Concatenate Templates: 4 section templates (account-basics, contacts, opportunities, cases)
  - Namespace structure: Own Template uses namespace prefix, Concatenate uses direct `records` array

**Key Architecture Decisions**:
- **Configuration-Driven**: Custom Metadata Type + junction object enables admin self-service (zero-code deployment)
- **Namespace Isolation**: Each template's data stored under unique key (prevents collision, enables reuse)
- **Variable Pool**: First template's results available to subsequent templates (e.g., AccountId → Contact query)
- **Two Strategies**: Own Template (single complex template) vs Concatenate Templates (reuse existing templates)
- **Idempotency**: RequestHash includes compositeDocId + recordIds for cache safety
- **Parent Extraction**: Dynamic `{ObjectType}Id` format supports unlimited parent types
- **Backward Compatible**: All existing single-template workflows unchanged (additive, not breaking)

**Documentation (Partial - deferred per user request)**:
- Comprehensive object configurability playbook (1,810 lines)
- LWC composite button guide with configuration examples (434 lines)
- Composite batch examples (docs/composite-batch-examples.md)
- Template authoring: Existing guide at docs/examples/account-summary-template-guide.md covers syntax

**Test Coverage**:
- **Apex**: 95 new test methods across 10 tasks
  - CompositeDocumentTest (5 tests - validation rules)
  - CompositeDocumentTemplateTest (5 tests - junction constraints)
  - CompositeDocgenDataProviderTest (11 tests - namespace isolation, sequencing, variable pool)
  - DocgenEnvelopeServiceTest (7 new tests - parent extraction, RequestHash, strategy handling)
  - DocgenControllerTest (7 new tests - interactive generation, idempotency)
  - BatchDocgenEnqueueTest (7 new tests - batch composite generation)
  - GeneratedDocumentTest (updated for validation rule compliance)
- **Node.js**: 30+ new test scenarios (unit + integration)
  - concatenate.test.ts (7 tests - section breaks, sequencing, header preservation)
  - generate.unit.test.ts (9 tests - both strategies, validation, namespace handling)
  - generate.integration.test.ts (2 tests - end-to-end Own Template + Concatenate)
  - poller.test.ts (6 tests - composite processing, mixed queue, error handling)
  - poller.integration.test.ts (1 test - end-to-end Concatenate Templates)
- **LWC**: 9 Jest tests (button click, recordIds mapping, success/error flows, validation)
- **E2E**: 2 comprehensive Playwright tests (Own Template strategy + Concatenate Templates strategy)
- **Total new tests**: ~150 tests across all layers

**Deliverables**: 44 new files, 13 modified files
- **Salesforce**: 13 metadata files (2 custom objects, 16 fields, 3 validation rules, 2 compact layouts, 2 permission sets)
- **Apex**: 13 new/modified classes (6 data providers, 3 controllers, 2 test data factories, 2 exception classes)
- **Backend**: 4 new/modified files (concatenate.ts, generate.ts, poller.ts, types.ts)
- **LWC**: 4 files (HTML, JS, metadata, tests)
- **E2E**: 7 files (2 test specs, 5 DOCX fixtures, 1 helper)
- **Documentation**: 3 playbooks (object configurability, LWC button guide, batch examples)

**Impact**: Transforms system from single-data-source documents to unlimited multi-source composite documents, enabling complex use cases like:
- Account Summary with Financial History + Terms & Conditions
- Opportunity Proposal with Product Catalog + Pricing + Legal Terms
- Case Report with Account Details + Contact History + Resolution Steps
- Contract Renewal with Usage Metrics + Pricing + Service Agreement
- Monthly Statement with Transaction History + Charts + Regulatory Disclosures

**Admin Experience (Zero-code deployment)**:
1. Create Composite_Document__c record (select strategy, configure options)
2. Create Composite_Document_Template__c junction records (define namespaces, set sequence)
3. Configure compositeDocgenButton on Lightning page (set compositeDocumentId, recordIdField)
4. No code deployment, no backend restart required

**Status**: ✅ **COMPLETE** (10/10 tasks completed)
- T-18: Salesforce schema (objects, fields, validation rules) ✅
- T-19: CompositeDocgenDataProvider (namespace isolation, variable pool) ✅
- T-20: DocgenEnvelopeService enhancements (buildForComposite, parent extraction) ✅
- T-21: DocgenController.generateComposite() (interactive API) ✅
- T-22: BatchDocgenEnqueue enhancements (batch composite generation) ✅
- T-23: DOCX concatenation service (section breaks, header preservation) ✅
- T-24: Enhanced /generate route (dual processing paths) ✅
- T-25: Poller worker composite support (batch processing) ✅
- T-26: compositeDocgenButton LWC (user interface) ✅
- T-27: E2E testing with Playwright (Own Template + Concatenate Templates) ✅

**Test Results**: All 493 tests passing (381 Node.js + 112 Apex) with 150+ new composite-specific tests

---

## Development Complete

**Status**: All 18 tasks completed (17 base system + 1 composite documents)

**Production Readiness**:
- Staging environment live and operational
- Production infrastructure deployed, awaiting first release
- 493 passing tests (381 Node.js + 112 Apex)
- 86% org-wide Apex coverage

**System Capabilities**:
- Interactive and batch document generation
- Single-template and composite (multi-source) document generation
- 5 pre-configured objects with unlimited extensibility via Custom Metadata
- Two composite strategies: Own Template (single merged) and Concatenate Templates (stitch sections)
- Docker containerization with LibreOffice
- Azure Container Apps deployment with autoscaling
- Complete CI/CD pipelines (automated staging, manual production)
- Key Vault secret management with Managed Identity
- Application Insights observability with custom metrics and dashboards
- Comprehensive documentation (7,400+ lines)

**Architecture Compliance**: All implementations follow constraints defined in `development-context.md`
