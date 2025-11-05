# ADR 0004: Caching and Idempotency Strategy

**Status**: Accepted
**Date**: 2025-11-05
**Decision Makers**: Architecture Team

## Context

The service must:
1. **Minimize Salesforce API calls** for template fetches (cost and rate limits)
2. **Prevent duplicate document generation** for identical requests (idempotency)
3. **Handle retries safely** without creating duplicate files
4. **Support concurrent requests** from multiple users/batches

Key challenges:
- Templates are **immutable** (Salesforce `ContentVersion` never changes)
- Templates can be **large** (up to 10 MB)
- Requests may be **retried** (user clicks multiple times, batch retry logic)
- Multiple **container instances** running concurrently

## Decision

We will implement a **two-tier caching strategy**:

### 1. Template Cache (Immutable)

**What**: Cache downloaded DOCX template files in memory
**Key**: `ContentVersionId` (Salesforce's immutable version identifier)
**TTL**: Infinite (templates never change once uploaded)
**Storage**: In-memory Map (per container instance)

**Rationale**:
- `ContentVersionId` is **immutable** - once created, never changes
- Templates reused across many documents (same template, different data)
- Eliminates repeated Salesforce API calls for template downloads

**Cache Structure**:
```typescript
const TEMPLATE_CACHE = new Map<string, Buffer>();

async function getTemplate(contentVersionId: string): Promise<Buffer> {
  if (TEMPLATE_CACHE.has(contentVersionId)) {
    return TEMPLATE_CACHE.get(contentVersionId);
  }

  const template = await salesforce.downloadContentVersion(contentVersionId);
  TEMPLATE_CACHE.set(contentVersionId, template);
  return template;
}
```

**Cache Invalidation**: Never (templates are immutable)

### 2. Idempotency via Request Hash

**What**: Deduplicate identical generation requests
**Key**: `RequestHash` (SHA-256 of `{templateId, outputFormat, data}`)
**Storage**: Salesforce `Generated_Document__c.RequestHash__c` (External ID, Unique)
**Behavior**: If hash exists with status `SUCCEEDED`, return existing `ContentVersionId`

**Hash Computation** (in Apex):
```apex
String hashInput = templateId + '|' + outputFormat + '|' + canonicalJson(data);
Blob hash = Crypto.generateDigest('SHA-256', Blob.valueOf(hashInput));
String requestHash = 'sha256:' + EncodingUtil.convertToHex(hash);
```

**Idempotency Flow**:
```
1. Apex computes RequestHash before calling Node
2. Apex inserts/upserts Generated_Document__c by RequestHash (External ID)
3. Node receives request
4. Node queries Salesforce for existing record with same RequestHash
5. If SUCCEEDED record exists:
   - Return existing ContentVersionId (no regeneration)
6. Else:
   - Generate document
   - Update record with OutputFileId
```

**Benefits**:
- **User double-clicks**: Same document returned instantly
- **Batch retries**: Failed jobs re-run safely without duplicate files
- **Audit trail**: All attempts tracked in Salesforce record history

## Alternatives Considered

### Alternative 1: Distributed Cache (Redis)
**Rejected**: Adds infrastructure complexity and cost. In-memory cache per instance is sufficient; templates are typically < 5 MB.

### Alternative 2: Template Cache with TTL (e.g., 1 hour)
**Rejected**: Unnecessary - `ContentVersionId` is immutable. Infinite TTL is safe and maximizes cache hits.

### Alternative 3: Idempotency Key in Header
**Rejected**: Requires clients to generate and pass key. Computing hash server-side from request body is more reliable.

### Alternative 4: Database Table for Idempotency
**Rejected**: Salesforce records already provide External ID and uniqueness constraints. No need for separate table.

### Alternative 5: ETag-based Caching
**Rejected**: Not applicable - we don't serve templates via HTTP responses. Internal cache only.

## Consequences

### Positive
- **Fast template reuse**: No Salesforce API call for cached templates
- **Idempotency guarantees**: Safe retries without duplicate files
- **Cost savings**: Reduced Salesforce API calls
- **Simple implementation**: No external cache infrastructure
- **Audit trail**: All requests logged in Salesforce

### Negative
- **Memory usage**: Large templates consume container RAM (mitigated by 10 MB template limit)
- **Cache cold start**: First request per template is slower (subsequent requests fast)
- **No cross-instance cache**: Each container caches independently (acceptable - templates shared within instance lifetime)

### Operational Impact
- **Memory monitoring**: Track template cache size (alert if > 500 MB)
- **Cache warming**: Consider pre-loading frequently used templates at startup
- **Garbage collection**: Node.js GC handles Map cleanup automatically

## Implementation Notes

### Template Cache Size Limit
```typescript
const MAX_CACHE_SIZE_MB = 500;
let currentCacheSizeBytes = 0;

async function getTemplate(cvId: string): Promise<Buffer> {
  if (TEMPLATE_CACHE.has(cvId)) {
    metrics.increment('template_cache_hit');
    return TEMPLATE_CACHE.get(cvId);
  }

  const template = await sf.downloadContentVersion(cvId);
  const sizeBytes = template.length;

  if (currentCacheSizeBytes + sizeBytes > MAX_CACHE_SIZE_MB * 1024 * 1024) {
    // Evict oldest entries (LRU)
    evictOldestTemplate();
  }

  TEMPLATE_CACHE.set(cvId, template);
  currentCacheSizeBytes += sizeBytes;
  metrics.increment('template_cache_miss');

  return template;
}
```

### Idempotency Check
```typescript
async function generateDocument(request: DocgenRequest): Promise<DocgenResponse> {
  // Check for existing succeeded document
  const existing = await sf.query(`
    SELECT Id, Status__c, OutputFileId__c, ContentVersionId
    FROM Generated_Document__c
    WHERE RequestHash__c = '${request.requestHash}'
    LIMIT 1
  `);

  if (existing && existing.Status__c === 'SUCCEEDED') {
    logger.info('Idempotent request detected', { requestHash: request.requestHash });
    metrics.increment('idempotent_request_total');
    return {
      downloadUrl: buildDownloadUrl(existing.OutputFileId__c),
      contentVersionId: existing.OutputFileId__c,
      correlationId: request.correlationId,
    };
  }

  // Proceed with generation...
}
```

### Canonical JSON for Hash Consistency
**Important**: Hash must be **deterministic** across requests.

**Apex Implementation**:
```apex
// Sort object keys, remove whitespace
String canonicalJson = JSON.serialize(data, true); // Pretty print disabled
// Further normalization if needed (e.g., field order)
```

**Alternatives**:
- Use JSON.serializeUntyped with sorted keys
- Hash only critical fields (templateId, parent IDs, key data fields)

## Image Handling (Related)

**Preference**: Base64-encoded images in request payload
**Fallback**: External HTTPS URLs with **allowlist** validation

**Why Base64**:
- **No external HTTP calls** during merge
- **Faster**: No network latency
- **More reliable**: No broken links or DNS issues

**Allowlist Example**:
```
cdn.company.com
images.salesforce.com
secure.assets.example.com
```

**Validation**:
```typescript
const IMAGE_ALLOWLIST = process.env.IMAGE_ALLOWLIST.split(',');

function isImageUrlAllowed(url: string): boolean {
  const hostname = new URL(url).hostname;
  return IMAGE_ALLOWLIST.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`));
}
```

## Monitoring Metrics

**Template Cache**:
- `template_cache_hit_total`: Cache hit count
- `template_cache_miss_total`: Cache miss count
- `template_cache_size_bytes`: Current cache memory usage
- `template_cache_evictions_total`: LRU eviction count

**Idempotency**:
- `idempotent_request_total`: Requests served from existing record
- `duplicate_request_hash_errors_total`: Hash collision errors (should be zero)

## References

- Development Context: `development-context.md` Sections 3, 10, 12
- [HTTP Idempotency](https://tools.ietf.org/html/rfc7231#section-4.2.2)
- [Content-Addressed Storage](https://en.wikipedia.org/wiki/Content-addressable_storage)
- [Salesforce External ID](https://help.salesforce.com/s/articleView?id=sf.fields_about_custom_external_id.htm)
