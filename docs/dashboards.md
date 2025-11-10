# Azure Application Insights Dashboards & Alerts

This document provides KQL queries, alert definitions, and dashboard layouts for monitoring the Docgen service in production.

## Table of Contents

- [Key Performance Indicators (KPIs)](#key-performance-indicators-kpis)
- [Service Level Objectives (SLOs)](#service-level-objectives-slos)
- [Dashboards](#dashboards)
  - [Overview Dashboard](#overview-dashboard)
  - [Performance Dashboard](#performance-dashboard)
  - [Reliability Dashboard](#reliability-dashboard)
  - [Capacity Dashboard](#capacity-dashboard)
- [KQL Queries](#kql-queries)
  - [Document Generation Metrics](#document-generation-metrics)
  - [Failure Analysis](#failure-analysis)
  - [Queue Monitoring](#queue-monitoring)
  - [Dependency Performance](#dependency-performance)
  - [Cache Performance](#cache-performance)
- [Alert Rules](#alert-rules)
- [Troubleshooting Runbook](#troubleshooting-runbook)

---

## Key Performance Indicators (KPIs)

### Primary KPIs

1. **Document Generation Success Rate**
   - Target: ≥99.5%
   - Critical threshold: <95%

2. **Document Generation Duration (P95)**
   - Target: ≤10 seconds
   - Warning threshold: >15 seconds
   - Critical threshold: >30 seconds

3. **Queue Depth**
   - Normal: <50 documents
   - Warning threshold: >100 documents
   - Critical threshold: >500 documents

4. **Retry Rate**
   - Normal: <5%
   - Warning threshold: >10%
   - Critical threshold: >25%

### Secondary KPIs

5. **Template Cache Hit Rate**
   - Target: ≥95%
   - Warning threshold: <80%

6. **Salesforce API Dependency Duration (P95)**
   - Target: ≤2 seconds
   - Warning threshold: >5 seconds

7. **LibreOffice Conversion Duration (P95)**
   - Target: ≤8 seconds
   - Warning threshold: >15 seconds

8. **Conversion Pool Utilization**
   - Normal: <80%
   - Warning threshold: >90%

---

## Service Level Objectives (SLOs)

### Availability SLO

- **Target**: 99.9% availability over a 30-day rolling window
- **Error Budget**: 43 minutes of downtime per month
- **Measurement**: Percentage of successful HTTP 200 responses on `/generate` endpoint

### Latency SLO

- **Target**: 95% of requests complete within 10 seconds
- **Measurement**: P95 duration of `docgen_duration_ms` metric

### Reliability SLO

- **Target**: 99.5% of document generation requests succeed
- **Measurement**: Success rate calculated from `docgen_failures_total` vs total requests

---

## Dashboards

### Overview Dashboard

**Purpose**: High-level health and performance monitoring

**Widgets**:
1. Request Rate (requests/minute) - Time chart
2. Success Rate (%) - Single value with trend
3. P50/P95/P99 Duration - Time chart
4. Failure Rate by Reason - Pie chart
5. Queue Depth - Time chart
6. Active Conversion Jobs - Time chart

**Refresh Rate**: 1 minute

---

### Performance Dashboard

**Purpose**: Detailed performance analysis

**Widgets**:
1. Document Generation Duration Distribution - Histogram
2. Duration by Output Format (PDF vs DOCX) - Time chart
3. Duration by Mode (Interactive vs Batch) - Time chart
4. Salesforce API Dependency Duration - Time chart
5. LibreOffice Conversion Duration - Time chart
6. Template Cache Performance - Time chart (hits vs misses)

**Refresh Rate**: 30 seconds

---

### Reliability Dashboard

**Purpose**: Failure analysis and reliability metrics

**Widgets**:
1. Failure Rate Over Time - Time chart
2. Failures by Reason - Stacked area chart
3. Retry Attempts Distribution - Bar chart
4. Failed Documents by Template ID - Table
5. Error Rate by Dependency - Time chart
6. Success Rate by Mode (Interactive vs Batch) - Time chart

**Refresh Rate**: 1 minute

---

### Capacity Dashboard

**Purpose**: Resource utilization and capacity planning

**Widgets**:
1. Queue Depth Over Time - Time chart
2. Conversion Pool Utilization - Time chart
3. Active vs Queued Conversion Jobs - Stacked area chart
4. Processing Rate (docs/minute) - Time chart
5. Retry Rate Over Time - Time chart
6. Template Cache Size - Time chart

**Refresh Rate**: 1 minute

---

## KQL Queries

### Document Generation Metrics

#### 1. Request Rate (Requests per Minute)

```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| summarize RequestCount = count() by bin(timestamp, 1m)
| render timechart
```

#### 2. Success Rate

```kusto
let totalRequests = customMetrics
    | where name == "docgen_duration_ms"
    | where timestamp > ago(1h)
    | count;
let failures = customMetrics
    | where name == "docgen_failures_total"
    | where timestamp > ago(1h)
    | summarize FailureCount = sum(value);
let successRate = (todouble(totalRequests) - todouble(failures)) / todouble(totalRequests) * 100;
print SuccessRate = strcat(round(successRate, 2), "%")
```

#### 3. P50, P95, P99 Duration

```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| summarize
    P50 = percentile(value, 50),
    P95 = percentile(value, 95),
    P99 = percentile(value, 99)
    by bin(timestamp, 5m)
| render timechart
```

#### 4. Duration by Output Format

```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| extend outputFormat = tostring(customDimensions.outputFormat)
| summarize
    P95Duration = percentile(value, 95)
    by bin(timestamp, 5m), outputFormat
| render timechart
```

#### 5. Duration by Mode (Interactive vs Batch)

```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| extend mode = tostring(customDimensions.mode)
| summarize
    P95Duration = percentile(value, 95)
    by bin(timestamp, 5m), mode
| render timechart
```

#### 6. Duration Distribution Histogram

```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| summarize count() by bin(value, 1000) // 1-second buckets
| render columnchart
```

---

### Failure Analysis

#### 7. Failure Rate Over Time

```kusto
customMetrics
| where name == "docgen_failures_total"
| where timestamp > ago(24h)
| summarize FailureCount = sum(value) by bin(timestamp, 5m)
| render timechart
```

#### 8. Failures by Reason

```kusto
customMetrics
| where name == "docgen_failures_total"
| where timestamp > ago(24h)
| extend reason = tostring(customDimensions.reason)
| summarize FailureCount = sum(value) by reason
| render piechart
```

#### 9. Failures by Reason Over Time (Stacked)

```kusto
customMetrics
| where name == "docgen_failures_total"
| where timestamp > ago(24h)
| extend reason = tostring(customDimensions.reason)
| summarize FailureCount = sum(value) by bin(timestamp, 10m), reason
| render areachart kind=stacked
```

#### 10. Top Failing Templates

```kusto
customMetrics
| where name == "docgen_failures_total"
| where timestamp > ago(24h)
| extend templateId = tostring(customDimensions.templateId)
| summarize FailureCount = sum(value) by templateId
| top 10 by FailureCount desc
| render table
```

#### 11. Failure Rate by Output Format

```kusto
customMetrics
| where name == "docgen_failures_total"
| where timestamp > ago(24h)
| extend outputFormat = tostring(customDimensions.outputFormat)
| summarize FailureCount = sum(value) by outputFormat
| render barchart
```

---

### Queue Monitoring

#### 12. Queue Depth Over Time

```kusto
customMetrics
| where name == "queue_depth"
| where timestamp > ago(1h)
| project timestamp, QueueDepth = value
| render timechart
```

#### 13. Queue Depth Statistics

```kusto
customMetrics
| where name == "queue_depth"
| where timestamp > ago(24h)
| summarize
    Avg = avg(value),
    Max = max(value),
    Min = min(value),
    P95 = percentile(value, 95)
```

#### 14. Processing Rate (Documents per Minute)

```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(1h)
| extend mode = tostring(customDimensions.mode)
| summarize DocsProcessed = count() by bin(timestamp, 1m), mode
| render timechart
```

---

### Dependency Performance

#### 15. Salesforce API Dependency Duration

```kusto
dependencies
| where type == "Salesforce REST API"
| where timestamp > ago(1h)
| summarize
    P50 = percentile(duration, 50),
    P95 = percentile(duration, 95),
    P99 = percentile(duration, 99)
    by bin(timestamp, 5m)
| render timechart
```

#### 16. Salesforce API Failure Rate

```kusto
dependencies
| where type == "Salesforce REST API"
| where timestamp > ago(24h)
| summarize
    TotalCalls = count(),
    FailedCalls = countif(success == false)
| extend FailureRate = (todouble(FailedCalls) / todouble(TotalCalls)) * 100
| project FailureRate
```

#### 17. LibreOffice Conversion Duration

```kusto
dependencies
| where type == "LibreOffice"
| where timestamp > ago(1h)
| summarize
    P50 = percentile(duration, 50),
    P95 = percentile(duration, 95),
    P99 = percentile(duration, 99)
    by bin(timestamp, 5m)
| render timechart
```

#### 18. LibreOffice Failure Rate

```kusto
dependencies
| where type == "LibreOffice"
| where timestamp > ago(24h)
| summarize
    TotalConversions = count(),
    FailedConversions = countif(success == false)
| extend FailureRate = (todouble(FailedConversions) / todouble(TotalConversions)) * 100
| project FailureRate
```

#### 19. Slowest Salesforce API Calls

```kusto
dependencies
| where type == "Salesforce REST API"
| where timestamp > ago(1h)
| top 20 by duration desc
| project timestamp, name, duration, success, customDimensions
| render table
```

---

### Cache Performance

#### 20. Template Cache Hit Rate

```kusto
let hits = customMetrics
    | where name == "template_cache_hit"
    | where timestamp > ago(1h)
    | summarize HitCount = sum(value);
let misses = customMetrics
    | where name == "template_cache_miss"
    | where timestamp > ago(1h)
    | summarize MissCount = sum(value);
let hitRate = todouble(hits) / (todouble(hits) + todouble(misses)) * 100;
print CacheHitRate = strcat(round(hitRate, 2), "%")
```

#### 21. Cache Hits vs Misses Over Time

```kusto
customMetrics
| where name in ("template_cache_hit", "template_cache_miss")
| where timestamp > ago(24h)
| summarize Count = sum(value) by bin(timestamp, 10m), name
| render timechart
```

---

### Retry Analysis

#### 22. Retry Rate

```kusto
let totalFailures = customMetrics
    | where name == "docgen_failures_total"
    | where timestamp > ago(24h)
    | summarize TotalFailures = sum(value);
let retries = customMetrics
    | where name == "retries_total"
    | where timestamp > ago(24h)
    | summarize RetryCount = sum(value);
let retryRate = (todouble(retries) / todouble(totalFailures)) * 100;
print RetryRate = strcat(round(retryRate, 2), "%")
```

#### 23. Retries by Attempt Number

```kusto
customMetrics
| where name == "retries_total"
| where timestamp > ago(24h)
| extend attempt = toint(customDimensions.attempt)
| summarize RetryCount = sum(value) by attempt
| render barchart
```

#### 24. Retry Trends Over Time

```kusto
customMetrics
| where name == "retries_total"
| where timestamp > ago(24h)
| extend attempt = toint(customDimensions.attempt)
| summarize RetryCount = sum(value) by bin(timestamp, 1h), attempt
| render timechart
```

---

### Conversion Pool Monitoring

#### 25. Conversion Pool Utilization

```kusto
customMetrics
| where name in ("conversion_pool_active", "conversion_pool_queued")
| where timestamp > ago(1h)
| summarize Value = avg(value) by bin(timestamp, 1m), name
| render timechart
```

#### 26. Pool Saturation (Active Jobs / Max Concurrent)

```kusto
customMetrics
| where name == "conversion_pool_active"
| where timestamp > ago(1h)
| extend utilizationPercent = (value / 8.0) * 100 // 8 is max concurrent
| summarize AvgUtilization = avg(utilizationPercent) by bin(timestamp, 1m)
| render timechart
```

---

## Alert Rules

### Critical Alerts

#### Alert 1: High Failure Rate

**Condition**: Failure rate >5% over 10 minutes

```kusto
let window = 10m;
let threshold = 5.0; // 5%
let totalRequests = customMetrics
    | where name == "docgen_duration_ms"
    | where timestamp > ago(window)
    | count;
let failures = customMetrics
    | where name == "docgen_failures_total"
    | where timestamp > ago(window)
    | summarize FailureCount = sum(value);
let failureRate = (todouble(failures) / todouble(totalRequests)) * 100;
failureRate > threshold
```

**Severity**: Critical (Sev 1)
**Action**: Page on-call engineer
**Runbook**: [High Failure Rate](#runbook-high-failure-rate)

---

#### Alert 2: Queue Depth Sustained High

**Condition**: Queue depth >100 for 15 minutes

```kusto
customMetrics
| where name == "queue_depth"
| where timestamp > ago(15m)
| summarize AvgQueueDepth = avg(value)
| where AvgQueueDepth > 100
```

**Severity**: Warning (Sev 2)
**Action**: Notify team channel
**Runbook**: [High Queue Depth](#runbook-high-queue-depth)

---

#### Alert 3: P95 Duration Exceeds SLO

**Condition**: P95 duration >10 seconds over 5 minutes

```kusto
customMetrics
| where name == "docgen_duration_ms"
| where timestamp > ago(5m)
| summarize P95Duration = percentile(value, 95)
| where P95Duration > 10000 // 10 seconds in milliseconds
```

**Severity**: Warning (Sev 2)
**Action**: Notify team channel
**Runbook**: [Slow Performance](#runbook-slow-performance)

---

#### Alert 4: Conversion Timeout Spike

**Condition**: >10 conversion timeouts in 5 minutes

```kusto
customMetrics
| where name == "docgen_failures_total"
| where timestamp > ago(5m)
| extend reason = tostring(customDimensions.reason)
| where reason == "conversion_timeout"
| summarize TimeoutCount = sum(value)
| where TimeoutCount > 10
```

**Severity**: Critical (Sev 1)
**Action**: Page on-call engineer
**Runbook**: [Conversion Timeouts](#runbook-conversion-timeouts)

---

#### Alert 5: Low Cache Hit Rate

**Condition**: Cache hit rate <80% over 30 minutes

```kusto
let window = 30m;
let threshold = 80.0; // 80%
let hits = customMetrics
    | where name == "template_cache_hit"
    | where timestamp > ago(window)
    | summarize HitCount = sum(value);
let misses = customMetrics
    | where name == "template_cache_miss"
    | where timestamp > ago(window)
    | summarize MissCount = sum(value);
let hitRate = (todouble(hits) / (todouble(hits) + todouble(misses))) * 100;
hitRate < threshold
```

**Severity**: Warning (Sev 2)
**Action**: Notify team channel
**Runbook**: [Low Cache Hit Rate](#runbook-low-cache-hit-rate)

---

#### Alert 6: Salesforce API Degradation

**Condition**: Salesforce API P95 >5 seconds over 5 minutes

```kusto
dependencies
| where type == "Salesforce REST API"
| where timestamp > ago(5m)
| summarize P95Duration = percentile(duration, 95)
| where P95Duration > 5000 // 5 seconds in milliseconds
```

**Severity**: Warning (Sev 2)
**Action**: Notify team channel
**Runbook**: [Salesforce Degradation](#runbook-salesforce-degradation)

---

## Troubleshooting Runbook

### Runbook: High Failure Rate

**Symptoms**: Failure rate >5% over 10 minutes

**Diagnosis Steps**:
1. Check failure breakdown by reason:
   ```kusto
   customMetrics
   | where name == "docgen_failures_total"
   | where timestamp > ago(10m)
   | extend reason = tostring(customDimensions.reason)
   | summarize FailureCount = sum(value) by reason
   ```

2. Identify failing templates:
   ```kusto
   customMetrics
   | where name == "docgen_failures_total"
   | where timestamp > ago(10m)
   | extend templateId = tostring(customDimensions.templateId)
   | summarize FailureCount = sum(value) by templateId
   | top 5 by FailureCount desc
   ```

**Common Causes & Remediation**:
- **template_not_found**: Template deleted or ID mismatch → Verify templates exist in Salesforce
- **conversion_timeout**: LibreOffice overloaded → Check conversion pool utilization, consider scaling
- **upload_failed**: Salesforce API issues → Check Salesforce status, verify auth token
- **validation_error**: Bad request data → Review recent Apex changes, check data formatting

---

### Runbook: High Queue Depth

**Symptoms**: Queue depth >100 for 15 minutes

**Diagnosis Steps**:
1. Check processing rate:
   ```kusto
   customMetrics
   | where name == "docgen_duration_ms"
   | where timestamp > ago(15m)
   | extend mode = tostring(customDimensions.mode)
   | where mode == "batch"
   | summarize DocsPerMinute = count() by bin(timestamp, 1m)
   ```

2. Check conversion pool utilization:
   ```kusto
   customMetrics
   | where name == "conversion_pool_active"
   | where timestamp > ago(15m)
   | summarize AvgActive = avg(value), MaxActive = max(value)
   ```

**Common Causes & Remediation**:
- **Batch job surge**: Large batch submitted → Monitor and wait; queue will drain
- **Slow processing**: Conversion timeouts increasing → Check LibreOffice performance
- **Pool saturation**: Active jobs consistently at 8 → Consider horizontal scaling (increase replicas)
- **Stuck locks**: Documents locked but not processing → Check for stale `LockedUntil__c` timestamps

---

### Runbook: Slow Performance

**Symptoms**: P95 duration >10 seconds over 5 minutes

**Diagnosis Steps**:
1. Break down by dependency:
   ```kusto
   dependencies
   | where timestamp > ago(5m)
   | summarize P95Duration = percentile(duration, 95) by type
   ```

2. Check for slow templates:
   ```kusto
   customMetrics
   | where name == "docgen_duration_ms"
   | where timestamp > ago(5m)
   | extend templateId = tostring(customDimensions.templateId)
   | summarize P95Duration = percentile(value, 95) by templateId
   | top 5 by P95Duration desc
   ```

**Common Causes & Remediation**:
- **Salesforce API slow**: P95 >2s → Check Salesforce status, verify network latency
- **LibreOffice slow**: P95 >8s → Check CPU usage, consider complex template optimization
- **Large documents**: File size >10MB → Optimize template (reduce images, simplify tables)
- **Cache misses**: Hit rate <95% → Verify cache configuration, check eviction rate

---

### Runbook: Conversion Timeouts

**Symptoms**: >10 conversion timeouts in 5 minutes

**Diagnosis Steps**:
1. Check affected templates:
   ```kusto
   customMetrics
   | where name == "docgen_failures_total"
   | where timestamp > ago(5m)
   | extend reason = tostring(customDimensions.reason)
   | where reason == "conversion_timeout"
   | extend templateId = tostring(customDimensions.templateId)
   | summarize TimeoutCount = sum(value) by templateId
   ```

2. Check conversion pool saturation:
   ```kusto
   customMetrics
   | where name == "conversion_pool_active"
   | where timestamp > ago(5m)
   | summarize AvgActive = avg(value)
   ```

**Common Causes & Remediation**:
- **Complex templates**: Large tables, many images → Optimize template design
- **LibreOffice hang**: Process not responding → Restart service (handled automatically)
- **Resource exhaustion**: CPU/memory saturated → Scale horizontally (increase replicas)
- **Timeout too aggressive**: 60s not enough → Consider increasing `CONVERSION_TIMEOUT`

---

### Runbook: Low Cache Hit Rate

**Symptoms**: Cache hit rate <80% over 30 minutes

**Diagnosis Steps**:
1. Check cache eviction rate (if available)
2. Analyze template usage patterns:
   ```kusto
   customMetrics
   | where name == "template_cache_miss"
   | where timestamp > ago(30m)
   | extend templateId = tostring(customDimensions.templateId)
   | summarize MissCount = sum(value) by templateId
   | top 10 by MissCount desc
   ```

**Common Causes & Remediation**:
- **High template churn**: Many templates updated → Expected behavior, monitor
- **Cache size too small**: Evictions frequent → Increase cache size limit
- **New templates**: Recently added templates → Expected initial misses
- **Service restarts**: Container scaled/restarted → Cache warming needed

---

### Runbook: Salesforce Degradation

**Symptoms**: Salesforce API P95 >5 seconds over 5 minutes

**Diagnosis Steps**:
1. Check Salesforce status: https://status.salesforce.com
2. Identify slow API calls:
   ```kusto
   dependencies
   | where type == "Salesforce REST API"
   | where timestamp > ago(5m)
   | where duration > 5000
   | summarize SlowCallCount = count() by name
   | top 5 by SlowCallCount desc
   ```

**Common Causes & Remediation**:
- **Salesforce incident**: Platform degradation → Monitor Salesforce status, wait for resolution
- **Large file uploads**: ContentVersion creation slow → Expected for large PDFs, monitor
- **Token refresh overhead**: Frequent 401s → Check auth token caching
- **Network latency**: Azure <> Salesforce path slow → Verify network connectivity

---

## Dashboard Setup Instructions

### 1. Create Application Insights Resource

1. Navigate to Azure Portal
2. Create Application Insights resource:
   - Resource Group: `rg-docgen-prod-uksouth`
   - Region: UK South
   - Name: `appi-docgen-prod-uksouth`
3. Copy **Instrumentation Key** and **Connection String**
4. Set environment variable: `AZURE_MONITOR_CONNECTION_STRING`

### 2. Import Dashboard Templates

1. Navigate to Application Insights → Dashboards
2. Click "New Dashboard"
3. For each dashboard (Overview, Performance, Reliability, Capacity):
   - Add widgets using KQL queries above
   - Configure time ranges and refresh rates
   - Save dashboard with appropriate name

### 3. Configure Alert Rules

1. Navigate to Application Insights → Alerts
2. Click "New Alert Rule"
3. For each alert:
   - Set condition using KQL query
   - Configure action groups (email, SMS, webhook)
   - Set severity level
   - Link to runbook documentation

### 4. Set Up Workbooks (Optional)

For advanced analysis, create Azure Monitor Workbooks:
- Failure Analysis Workbook
- Performance Profiling Workbook
- Capacity Planning Workbook

---

## Best Practices

1. **Regular Review**: Review dashboards daily during business hours
2. **Alert Tuning**: Adjust thresholds based on observed baseline
3. **Incident Response**: Follow runbooks during incidents
4. **Capacity Planning**: Monitor trends weekly for scaling decisions
5. **Performance Optimization**: Investigate P95/P99 spikes proactively
6. **Documentation**: Update runbooks with lessons learned

---

## Additional Resources

- [Azure Application Insights Documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [KQL Quick Reference](https://learn.microsoft.com/en-us/azure/data-explorer/kql-quick-reference)
- [Alerting Best Practices](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-overview)
- [Docgen Architecture Decision Records](../docs/adrs/)
- [Docgen Development Tasks](../development-tasks.md)
