# ADR 0003: Worker Polling and Batch Processing Model

**Status**: Accepted
**Date**: 2025-11-05
**Decision Makers**: Architecture Team

## Context

The service must support two document generation modes:
1. **Interactive**: Real-time generation triggered by user button clicks (sub-second response)
2. **Batch**: Mass generation for potentially thousands of documents (asynchronous, resilient)

For batch processing, we need:
- Reliable work queue with retries and backoff
- Distributed locking (multiple container instances)
- Failure recovery without data loss
- Observability into queue depth and processing rates

## Decision

We will implement an **internal polling worker** that:
- Runs in the same Node.js process as the API (co-located)
- Polls Salesforce every **15 seconds** for queued work
- Uses **Salesforce records as the queue** (`Generated_Document__c` custom object)
- Implements **optimistic locking** via `LockedUntil__c` timestamp field
- Processes up to **8 documents concurrently** per container instance

### Queue Model: Salesforce `Generated_Document__c` Records

**Status Lifecycle**:
```
QUEUED → PROCESSING → SUCCEEDED
                   ↓
                 FAILED (after 3 retries)
                   ↓
                CANCELED (manual intervention)
```

**Key Fields**:
- `Status__c` (Picklist): Current state
- `LockedUntil__c` (Datetime): Optimistic lock expiry
- `Attempts__c` (Number): Retry counter (max 3)
- `RequestHash__c` (External ID, Unique): Idempotency key
- `Priority__c` (Number): Future extension for prioritization
- `CorrelationId__c` (Text): Distributed tracing

### Polling Algorithm

**Every 15 seconds**:
1. **SELECT** up to 50 records WHERE:
   - `Status__c = 'QUEUED'`
   - `(LockedUntil__c = null OR LockedUntil__c < NOW())`
   - ORDER BY `CreatedDate ASC`, `Priority__c DESC` (FIFO with priority)

2. **UPDATE** selected records:
   - SET `Status__c = 'PROCESSING'`
   - SET `LockedUntil__c = NOW() + 2 minutes`
   - SET `CorrelationId__c = UUID()`

3. **PROCESS** with concurrency limit = 8

4. **ON SUCCESS**:
   - UPDATE `Status__c = 'SUCCEEDED'`
   - SET `OutputFileId__c = <ContentVersionId>`
   - CLEAR `LockedUntil__c`

5. **ON FAILURE**:
   - INCREMENT `Attempts__c`
   - IF `Attempts__c < 3`:
     - SET `Status__c = 'QUEUED'` (re-queue)
     - SET `ScheduledAfter__c = NOW() + backoff` (1m / 5m / 15m)
   - ELSE:
     - SET `Status__c = 'FAILED'`
     - SET `Error__c = <error message>`

### Backoff Strategy

**Exponential backoff** with fixed intervals:
- 1st retry: 1 minute
- 2nd retry: 5 minutes
- 3rd retry: 15 minutes
- After 3rd: Mark `FAILED`

### Distributed Locking

**Optimistic Locking** prevents duplicate processing:
- `LockedUntil__c` acts as a lease
- Lock TTL: 2 minutes (longer than max job duration)
- Stale locks automatically released after TTL
- No external lock manager (Redis, etc.) required

**Race Condition Handling**:
- Multiple workers may SELECT same rows
- First worker to UPDATE "wins" the lock
- Losers skip already-locked rows
- Idempotency key (`RequestHash__c`) prevents duplicate outputs

## Alternatives Considered

### Alternative 1: External Message Queue (Azure Service Bus, RabbitMQ)
**Rejected**: Adds infrastructure complexity and cost. Salesforce records provide sufficient queueing with better Salesforce integration.

### Alternative 2: Salesforce Platform Events
**Rejected**: Not durable (24-hour retention). Cannot replay failed jobs. No built-in retry logic.

### Alternative 3: Apex Queueable Chaining
**Rejected**: Governor limits (max 50 chained jobs), no backpressure control, harder to monitor externally.

### Alternative 4: Azure Durable Functions
**Rejected**: Requires separate Azure Functions deployment. Node container is simpler.

### Alternative 5: Webhooks from Salesforce
**Rejected**: No built-in retry logic, harder to implement backpressure and concurrency limits.

## Consequences

### Positive
- **No external infrastructure**: Queue is Salesforce records (no Redis, SQS, etc.)
- **Salesforce-native**: Leverages platform features (External IDs, SOQL, DML)
- **Visibility**: Queue depth visible in Salesforce UI and reports
- **Auditability**: Full history in `Generated_Document__c` records
- **Simple deployment**: Poller runs in same container as API
- **Automatic cleanup**: Stale locks released via timestamp comparison

### Negative
- **Polling overhead**: 15-second interval = 4 queries/minute per instance
- **SOQL governor limits**: Must batch SELECT (50 rows) to avoid limits
- **Lock granularity**: 2-minute TTL means stuck jobs delay retries
- **Salesforce API dependency**: Polling requires API calls (counts toward limits)

### Operational Impact
- **Scaling**: More replicas = faster queue drain (but more API calls)
- **Monitoring**: Track `queue_depth`, `processing_rate`, `retry_rate` metrics
- **Dead letter queue**: `FAILED` records require manual review
- **Lock tuning**: Adjust TTL if jobs frequently timeout

## Implementation Notes

### Poller Pseudocode
```typescript
async function poll() {
  while (true) {
    try {
      const queued = await fetchQueuedDocuments(50);
      const locked = await lockDocuments(queued);
      await processConcurrently(locked, 8, generateDocument);
    } catch (err) {
      logger.error('Poller error', err);
    }
    await sleep(15_000);
  }
}

async function lockDocuments(docs) {
  const lockExpiry = new Date(Date.now() + 120_000); // 2 minutes
  const ids = docs.map(d => d.Id);
  await sf.update('Generated_Document__c', {
    Id: { $in: ids },
    Status__c: 'PROCESSING',
    LockedUntil__c: lockExpiry,
    CorrelationId__c: uuid.v4(),
  });
  return docs;
}
```

### Retry Backoff
```typescript
function getBackoffDelay(attempts: number): number {
  switch (attempts) {
    case 1: return 60_000;   // 1 minute
    case 2: return 300_000;  // 5 minutes
    case 3: return 900_000;  // 15 minutes
    default: return 0;
  }
}
```

### Concurrency Control
```typescript
const pLimit = require('p-limit');
const limit = pLimit(8); // Max 8 concurrent

const promises = documents.map(doc =>
  limit(() => generateDocument(doc))
);
await Promise.allSettled(promises);
```

## Monitoring and Alerts

**Key Metrics**:
- `queue_depth`: Current count of `QUEUED` records
- `processing_duration_ms`: Time to process one document
- `retry_total`: Count of retries by attempt number
- `failed_total`: Count of permanently failed jobs

**Alert Thresholds**:
- `queue_depth > 1000` for 10+ minutes → Scale up replicas
- `failed_total` spike → Investigate common error patterns
- `processing_duration_ms` p95 > 30s → LibreOffice performance issue

## References

- Development Context: `development-context.md` Sections 2, 9, 14
- [Optimistic Locking Pattern](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html)
- [Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
