# Technical Architecture

This document provides detailed technical implementation details for the Docgen service. For a high-level overview, see the main [README](../README.md).

## Table of Contents

- [Authentication (T-08)](#authentication-t-08)
- [Template Cache & Merging (T-10)](#template-cache--merging-t-10)
- [LibreOffice Conversion Pool (T-11)](#libreoffice-conversion-pool-t-11)
- [File Upload & Linking (T-12)](#file-upload--linking-t-12)
- [Batch Processing & Worker Poller (T-14)](#batch-processing--worker-poller-t-14)
- [Observability & Monitoring (T-15)](#observability--monitoring-t-15)

---

## Authentication (T-08)

### Azure AD JWT Validation

The service uses Azure AD (Entra ID) OAuth 2.0 for inbound authentication from Salesforce:

- **Protocol**: OAuth 2.0 Client Credentials Flow
- **Token Type**: JWT (RS256)
- **Validation**: JWKS-based signature verification with caching
- **Claims**: Validates issuer, audience, expiry, and not-before times

### Implementation Details

**Core Components**:
- `src/auth/aad.ts` - AAD JWT verifier with JWKS client
- `src/plugins/auth.ts` - Fastify authentication plugin
- `/generate` endpoint - Protected with `preHandler: fastify.authenticate`
- `/readyz` endpoint - Includes JWKS connectivity check

**Security Features**:
- JWKS key caching (5 minutes) to reduce external calls
- Rate limiting (10 JWKS requests/minute)
- Correlation ID propagation in auth failures
- Development mode bypass (NODE_ENV=development + AUTH_BYPASS_DEVELOPMENT=true)

**Environment Variables**:
```bash
# Azure AD JWT Validation
ISSUER=https://login.microsoftonline.com/<azure-tenant-id>/v2.0
AUDIENCE=api://<azure-client-id>
JWKS_URI=https://login.microsoftonline.com/<azure-tenant-id>/discovery/v2.0/keys

# Optional: Bypass auth in development
AUTH_BYPASS_DEVELOPMENT=true  # Only works when NODE_ENV=development
```

**Error Responses**:
- `401 Unauthorized` - Missing/expired/invalid token
- `403 Forbidden` - Wrong audience or issuer

---

## Template Cache & Merging (T-10)

### Template Caching

The service implements an immutable in-memory template cache per ADR-0004:

**Key Features**:
- **Immutable Caching**: Templates are cached by `ContentVersionId` with infinite TTL (ContentVersions are immutable in Salesforce)
- **LRU Eviction**: When cache exceeds 500 MB, least-recently-used templates are evicted
- **Cache Statistics**: Tracks hits, misses, evictions, size, and entry count
- **Thread-Safe**: Synchronous operations safe for single Node.js process

**Implementation**:
```typescript
// src/templates/cache.ts
export class TemplateCache {
  get(contentVersionId: string): Buffer | undefined
  set(contentVersionId: string, buffer: Buffer): void
  getStats(): TemplateCacheStats
  clear(): void
}
```

**Metrics**:
- `hits` - Number of cache hits
- `misses` - Number of cache misses (triggers Salesforce download)
- `evictions` - Number of LRU evictions
- `currentSize` - Total cache size in bytes
- `entryCount` - Number of cached templates

### Template Merging

The service uses the `docx-templates` library to merge Salesforce data with DOCX templates:

**Supported Features**:
- **Field Paths**: Salesforce API-style paths (e.g., `{{Account.Name}}`, `{{Opportunity.Owner.Name}}`)
- **Formatted Values**: Apex pre-formats currency, dates, numbers using `__formatted` suffix
- **Loops**: `{{#each Opportunity.LineItems}}...{{/each}}` for arrays
- **Conditionals**: `{{#if Account.IsPartner}}...{{/if}}` for boolean logic
- **Images**: Base64-encoded (preferred) or external URLs (allowlist validated)

**Example Template**:
```
Customer: {{Account.Name}}
Revenue: {{Account.AnnualRevenue__formatted}}

{{#each Opportunity.LineItems}}
  - {{Name}}: {{Quantity}} x {{UnitPrice__formatted}} = {{TotalPrice__formatted}}
{{/each}}

{{#if Account.IsPartner}}
  Partner Discount: 15%
{{/if}}
```

**Image Allowlist**:

External image URLs must be on the allowlist (configured via `IMAGE_ALLOWLIST` env var):

```bash
IMAGE_ALLOWLIST=cdn.example.com,images.company.com
```

- **Base64 images** (recommended): No validation needed, included directly in data
- **External URLs**: Validated against allowlist to prevent SSRF attacks

**Template Service Flow**:

1. Check cache for template by `ContentVersionId`
2. On miss: Download from Salesforce via `/services/data/v59.0/sobjects/ContentVersion/{Id}/VersionData`
3. Store in cache
4. Merge template with data using `docx-templates`
5. Return merged DOCX buffer

**Documentation**:
- [Template Authoring Guide](./template-authoring.md) - Complete guide with examples
- [ADR-0004: Caching & Idempotency](./adr/0004-caching.md)

---

## LibreOffice Conversion Pool (T-11)

The service converts merged DOCX files to PDF using LibreOffice (`soffice --headless`) with a bounded worker pool.

**Key Features**:
- **Bounded Concurrency**: Maximum 8 concurrent conversions per instance (per ADR-0003)
- **Timeout Handling**: Configurable timeout (default: 60 seconds) with process kill
- **Robust Cleanup**: Temp files cleaned up in all scenarios (success/failure/timeout)
- **Queue Management**: Jobs queue when pool is full and process sequentially
- **Stats Tracking**: Active jobs, queue depth, completed/failed counts for observability

**Configuration**:
```bash
CONVERSION_TIMEOUT=60000          # Timeout in milliseconds (default: 60000)
CONVERSION_WORKDIR=/tmp           # Working directory for temp files (default: /tmp)
CONVERSION_MAX_CONCURRENT=8       # Max concurrent conversions (default: 8)
```

**Implementation**:
```typescript
// src/convert/soffice.ts
export class LibreOfficeConverter {
  async convertToPdf(docxBuffer: Buffer, options?: ConversionOptions): Promise<Buffer>
  getStats(): ConversionPoolStats
}

// Convenience function using singleton
export async function convertDocxToPdf(docxBuffer: Buffer, options?: ConversionOptions): Promise<Buffer>
```

**Conversion Flow**:
1. Acquire slot in pool (max 8 concurrent, others queue)
2. Create temp directory: `/tmp/docgen-{correlationId}-{timestamp}/`
3. Write DOCX to temp file: `input.docx`
4. Execute: `soffice --headless --convert-to pdf --outdir {dir} input.docx`
5. Read generated PDF: `input.pdf`
6. Cleanup temp directory (always, even on error)
7. Release pool slot

**Error Handling**:
- **Timeout**: Process killed after configured timeout, error thrown
- **Crash**: Non-zero exit code captured, error message includes stderr
- **Cleanup Failure**: Logged as warning, doesn't fail conversion

**Pool Statistics**:
```typescript
interface ConversionPoolStats {
  activeJobs: number;      // Currently running conversions
  queuedJobs: number;      // Jobs waiting for slot
  completedJobs: number;   // Total successful conversions
  failedJobs: number;      // Total failed conversions
  totalConversions: number;  // Total attempts (completed + failed)
}
```

**Usage Example**:
```typescript
import { convertDocxToPdf } from './convert';

const docxBuffer = await mergeTemplate(templateBuffer, data);
const pdfBuffer = await convertDocxToPdf(docxBuffer, {
  timeout: 60000,
  correlationId: 'request-123'
});
```

**Constraints**:
- **Container Sizing**: 2 vCPU / 4 GB RAM (ACA East US)
- **Max Concurrent**: 8 jobs (chosen based on LibreOffice CPU/memory usage)
- **Workdir**: `/tmp` (ephemeral, cleaned up)
- **LibreOffice**: Installed via `apt-get install -y libreoffice`

---

## File Upload & Linking (T-12)

The service uploads generated documents to Salesforce Files and links them to parent records (Account, Opportunity, Case).

**Key Features**:
- **ContentVersion Upload**: Upload PDF (always) and DOCX (optional) to Salesforce Files
- **Multi-Parent Linking**: Create ContentDocumentLinks for all non-null parent IDs
- **Status Tracking**: Update `Generated_Document__c` with file IDs and status
- **Idempotency**: Apex-side cache check (24-hour window) prevents duplicate generation
- **Link Failure Handling**: Files left orphaned if linking fails; status set to FAILED

**Flow**:
1. Apex creates `Generated_Document__c` with `Status=PROCESSING`
2. Apex passes `generatedDocumentId` to Node in request envelope
3. Node uploads PDF as `ContentVersion` to Salesforce
4. Node optionally uploads DOCX (if `storeMergedDocx=true`)
5. Node creates `ContentDocumentLink` for each non-null parent (ShareType=V, Visibility=AllUsers)
6. Node updates `Generated_Document__c`:
   - Success: `Status=SUCCEEDED`, `OutputFileId__c` set
   - Link failure: `Status=FAILED`, file orphaned, error logged
   - Upload failure: `Status=FAILED`, error message set

**Implementation**:
```typescript
// src/sf/files.ts

// Upload file to Salesforce Files
export async function uploadContentVersion(
  buffer: Buffer,
  fileName: string,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<{ contentVersionId: string; contentDocumentId: string }>

// Create single ContentDocumentLink
export async function createContentDocumentLink(
  contentDocumentId: string,
  linkedEntityId: string,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<string>

// Create links for multiple parents (filters null values)
export async function createContentDocumentLinks(
  contentDocumentId: string,
  parents: DocgenParents,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<{ created: number; errors: string[] }>

// Update Generated_Document__c record
export async function updateGeneratedDocument(
  generatedDocumentId: string,
  fields: Partial<GeneratedDocumentUpdateFields>,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<void>

// Main orchestrator function
export async function uploadAndLinkFiles(
  pdfBuffer: Buffer,
  docxBuffer: Buffer | null,
  request: DocgenRequest,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<FileUploadResult>
```

**Idempotency Strategy**:
- **Apex**: Computes `RequestHash = sha256(templateId | outputFormat | sha256(data))`
- **Apex**: Checks for existing `SUCCEEDED` document within 24 hours before callout
- **Salesforce**: Enforces unique constraint on `RequestHash__c` (External ID)
- **Node**: Relies on Apex for idempotency (no duplicate check in Node layer)

See [Idempotency Documentation](./idempotency.md) for full details.

**ContentDocumentLink Strategy**:
- **ShareType**: `V` (Viewer permission)
- **Visibility**: `AllUsers` (visible to all users in org)
- **Parents**: Links created for `AccountId`, `OpportunityId`, `CaseId` (if non-null)
- **Failure Mode**: Link failures are non-fatal; file uploaded but orphaned, status=FAILED

**Data Types**:
```typescript
interface FileUploadResult {
  pdfContentVersionId: string;          // Always present
  docxContentVersionId?: string;         // Present if storeMergedDocx=true
  pdfContentDocumentId: string;          // For linking
  docxContentDocumentId?: string;        // For linking (if DOCX uploaded)
  linkCount: number;                     // Number of links created
  linkErrors: string[];                  // Non-fatal link errors
}

interface GeneratedDocumentUpdateFields {
  Status__c?: string;                    // SUCCEEDED | FAILED
  OutputFileId__c?: string;              // PDF ContentVersionId
  MergedDocxFileId__c?: string;          // Optional DOCX ContentVersionId
  Error__c?: string;                     // Error message if FAILED
}
```

**Test Coverage**: 21 tests in `test/sf.files.test.ts`
- Upload scenarios: success, retry, failure, correlation ID
- Linking scenarios: single parent, multiple parents, no parents, partial failures
- Update scenarios: success/failure status, both file IDs
- Integration scenarios: full upload+link+update flow

**Documentation**:
- [Idempotency Strategy](./idempotency.md)
- [ContentDocumentLink Strategy](./contentdocumentlink.md)

---

## Batch Processing & Worker Poller (T-14)

**Purpose**: Enable mass document generation at scale via Apex Batch/Queueable and Node.js poller worker.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      BATCH GENERATION FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Apex Batch/Queueable                                         │
│     └─> Inserts Generated_Document__c records (Status=QUEUED)   │
│         - RequestJSON__c: Full DocgenRequest envelope           │
│         - RequestHash__c: Idempotency key (External ID)         │
│         - Priority__c: Optional priority (higher = first)       │
│                                                                   │
│  2. Node Poller (every 15s active / 60s idle)                   │
│     └─> Query: Up to 20 QUEUED records not locked              │
│     └─> Lock: Sequential PATCH (Status=PROCESSING,             │
│         LockedUntil=now+2m)                                     │
│     └─> Process: Concurrent (max 8 via LibreOffice pool)       │
│         ├─> Fetch template                                     │
│         ├─> Merge + Convert                                    │
│         ├─> Upload to Salesforce Files                         │
│         └─> Link to parents                                    │
│     └─> Update: Status=SUCCEEDED/FAILED with retry backoff    │
│                                                                   │
│  3. Retry Strategy                                               │
│     - Attempt 1: Requeue after 1 minute                         │
│     - Attempt 2: Requeue after 5 minutes                        │
│     - Attempt 3: Requeue after 15 minutes                       │
│     - Attempt 4+: Mark as FAILED permanently                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Salesforce: Batch Enqueue

**Class**: `BatchDocgenEnqueue` (implements `Database.Batchable<Id>`)

```apex
// Enqueue 100 documents for a template
List<Id> recordIds = new List<Id>{/* Account IDs */};
Id templateId = 'a01xx000000abcdXXX';
String outputFormat = 'PDF';

BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
  templateId,
  recordIds,
  outputFormat
);
Database.executeBatch(batch, 200); // Batch size
```

**What it does**:
1. Validates template exists
2. For each record: builds envelope via `DocgenEnvelopeService`
3. Inserts `Generated_Document__c` with Status=QUEUED
4. Tracks success/failure counts across batches

**Test Coverage**: 7 tests in `force-app/main/default/classes/BatchDocgenEnqueueTest.cls`
- 10 and 50 record batches
- RequestHash uniqueness and idempotency
- DOCX output format support
- Error handling for missing templates

### Node.js: Worker Poller

**Class**: `PollerService` (`src/worker/poller.ts`)

**Always-On Architecture**:
The poller **auto-starts** when the application starts and runs continuously on all replicas. In multi-replica deployments (Azure Container Apps with 1-5 replicas), each replica runs its own poller. The Salesforce lock mechanism (`LockedUntil__c`) prevents duplicate work across replicas, making concurrent polling safe and efficient.

**API Endpoints** (all require AAD authentication):
- **GET /worker/status**: Current state for this replica (running, queue depth, last poll time)
- **GET /worker/stats**: Detailed metrics for this replica (processed, succeeded, failed, retries, uptime)

**Note**: In multi-replica deployments, status and stats are per-replica. Different requests may return different values depending on which replica handles the request.

**Configuration** (environment variables):
```env
POLLER_INTERVAL_MS=15000       # Active polling interval (15s)
POLLER_IDLE_INTERVAL_MS=60000  # Idle polling interval (60s)
POLLER_BATCH_SIZE=20           # Documents per poll (reduced from 50)
POLLER_LOCK_TTL_MS=120000      # Lock duration (2 minutes)
POLLER_MAX_ATTEMPTS=3          # Max retry attempts
```

**Adaptive Polling**:
- **Active mode** (15s): When documents found in previous poll
- **Idle mode** (60s): When no documents found (reduces API calls)

**Locking Strategy**:
- **Sequential PATCH**: Each document locked individually before processing
- **Lock TTL**: 2 minutes (prevents stuck locks)
- **Expired locks**: Automatically reclaimed on next poll
- **Conflict resolution**: If lock fails (409), skip document

**Concurrency**:
- **Fetch**: Up to 20 documents per poll
- **Processing**: Max 8 concurrent (enforced by LibreOffice pool)
- **Queue management**: Remaining documents queue internally

**Retry Backoff**:
```typescript
Attempt 1 → Requeue after 1m   (60,000ms)
Attempt 2 → Requeue after 5m   (300,000ms)
Attempt 3 → Requeue after 15m  (900,000ms)
Attempt 4+ → FAILED permanently
```

**Retryable vs Non-Retryable Errors**:
- **Non-retryable** (immediate FAILED): Template not found (404), invalid request (400)
- **Retryable** (backoff): Conversion timeout, upload failure (5xx), network errors

**Graceful Shutdown**:
1. Clear polling timer
2. Wait for all in-flight jobs to complete
3. Update stats and log shutdown
4. Called automatically on SIGTERM/SIGINT

**Example Usage**:
```bash
# Check status (per-replica)
curl -X GET https://docgen.azurecontainerapps.io/worker/status \
  -H "Authorization: Bearer $AAD_TOKEN"

# Get detailed stats (per-replica)
curl -X GET https://docgen.azurecontainerapps.io/worker/stats \
  -H "Authorization: Bearer $AAD_TOKEN"

# Note: Poller auto-starts with the application
# To stop polling, scale the container to 0 replicas
```

**Test Coverage**: 39 tests across 2 test files
- `test/worker/poller.test.ts` (19 tests): Fetch, lock, process, retry, backoff, adaptive polling, shutdown
- `test/routes/worker.test.ts` (20 tests): API endpoints, auth, error handling, status/stats

**Key Implementation Files**:
- `src/worker/poller.ts` (430 lines): Core PollerService class
- `src/routes/worker.ts` (200 lines): API endpoints
- `src/server.ts`: Worker routes registration + shutdown hook
- `force-app/.../BatchDocgenEnqueue.cls` (248 lines): Apex batch class

**Monitoring & Observability**:
- Correlation IDs propagated through all operations
- Structured logging with Pino
- Stats tracking: processed, succeeded, failed, retries, uptime
- Ready for Azure Application Insights integration (T-15)

**API Call Efficiency**:
- **Per Poll Cycle** (20 documents):
  - 1 SOQL query (fetch documents)
  - 20 PATCH calls (lock documents)
  - ~80-100 API calls (template download, upload, links, status updates)
  - **Total**: ~100-120 calls per 15s cycle
  - **Burst**: ~400-480 calls/minute during active processing
- **Mitigation**: Adaptive polling reduces calls during idle periods

**See Also**:
- [OpenAPI Worker Endpoints](../openapi.yaml#L283-L482) - Complete API documentation
- [Poller Documentation](./poller.md) - Additional implementation details

---

## Observability & Monitoring (T-15)

The service integrates **Azure Application Insights** via OpenTelemetry for comprehensive observability.

### Metrics Tracked

#### Document Generation Metrics

| Metric | Type | Dimensions | Description |
|--------|------|------------|-------------|
| `docgen_duration_ms` | Histogram | templateId, outputFormat, mode, correlationId | Document generation duration (for P50/P95/P99 analysis) |
| `docgen_failures_total` | Counter | reason, templateId, outputFormat, mode, correlationId | Failure counter with categorized reasons |
| `queue_depth` | Gauge | correlationId | Current number of queued documents (poller only) |
| `retries_total` | Counter | attempt, documentId, reason, correlationId | Retry attempts counter |

#### Cache Metrics

| Metric | Type | Dimensions | Description |
|--------|------|------------|-------------|
| `template_cache_hit` | Counter | templateId | Template cache hit counter |
| `template_cache_miss` | Counter | templateId | Template cache miss counter |

#### Conversion Pool Metrics

| Metric | Type | Dimensions | Description |
|--------|------|------------|-------------|
| `conversion_pool_active` | Gauge | - | Active conversion jobs |
| `conversion_pool_queued` | Gauge | - | Queued conversion jobs |

### Dependency Tracking

All external dependencies are tracked with duration, success/failure status, and correlation IDs:

- **Salesforce REST API**: Template downloads, file uploads, record updates
- **LibreOffice**: DOCX→PDF conversion operations

### Failure Reasons

Failures are categorized for targeted troubleshooting:

- `template_not_found` - Template missing or invalid ContentVersionId
- `validation_error` - Invalid request payload
- `conversion_timeout` - LibreOffice conversion exceeded timeout (default 60s)
- `conversion_failed` - LibreOffice process crashed or failed
- `upload_failed` - Salesforce file upload or API error
- `unknown` - Uncategorized errors

### Correlation ID Propagation

Every request/document includes a correlation ID that flows through:
1. HTTP request headers (`x-correlation-id`)
2. All log entries (structured JSON logging via Pino)
3. All metrics and dependencies (as dimension)
4. Salesforce API calls (propagated via header)
5. Error responses (included in response body)

This enables **distributed tracing** across Salesforce, Node.js service, and LibreOffice conversions.

### Configuration

```bash
# Azure Application Insights connection string (required for production)
AZURE_MONITOR_CONNECTION_STRING=InstrumentationKey=<key>;IngestionEndpoint=https://<region>.in.applicationinsights.azure.com/

# Optional: Disable telemetry (enabled by default in non-test environments)
ENABLE_TELEMETRY=false
```

### Dashboards & Alerts

Pre-built dashboards and alert rules are documented in [dashboards.md](./dashboards.md):

- **Overview Dashboard**: Request rate, success rate, P95 duration, failure breakdown
- **Performance Dashboard**: Duration distribution, dependency performance, cache hit rate
- **Reliability Dashboard**: Failure trends, retry analysis, error breakdown
- **Capacity Dashboard**: Queue depth, conversion pool utilization, processing rate

### Key Performance Indicators (KPIs)

| KPI | Target | Warning | Critical |
|-----|--------|---------|----------|
| Success Rate | ≥99.5% | <97% | <95% |
| P95 Duration | ≤10s | >15s | >30s |
| Queue Depth | <50 | >100 | >500 |
| Retry Rate | <5% | >10% | >25% |
| Cache Hit Rate | ≥95% | <80% | <70% |

### Sample KQL Queries

**Request Rate**:
```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| summarize RequestCount = count() by bin(timestamp, 1m)
| render timechart
```

**P95 Duration**:
```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| summarize P95 = percentile(value, 95) by bin(timestamp, 5m)
| render timechart
```

**Failure Breakdown**:
```kusto
customMetrics
| where name == "docgen_failures_total"
| where timestamp > ago(24h)
| extend reason = tostring(customDimensions.reason)
| summarize FailureCount = sum(value) by reason
| render piechart
```

**See Also**:
- [Dashboards & Monitoring Guide](./dashboards.md) - Complete KQL queries, alerts, and runbooks
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/) - OpenTelemetry concepts
- [Azure Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview) - App Insights overview
