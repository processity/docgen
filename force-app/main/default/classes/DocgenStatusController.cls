/**
 * Controller for the Docgen Status page
 * Provides system health, worker status, queue metrics, and worker control
 */
public with sharing class DocgenStatusController {

    private static final Integer TIMEOUT_MS = 30000; // 30 seconds
    private static final Integer RECENT_DOCUMENTS_LIMIT = 50;
    private static final Integer HOURS_FOR_METRICS = 24;
    private static final Integer TOP_TEMPLATES_LIMIT = 5;

    /**
     * Get Named Credential name from Custom Settings
     * Allows configuring different Named Credentials for different environments
     * Defaults to 'Docgen_Node_API' if not configured
     */
    @TestVisible
    private static String getNamedCredentialName() {
        Docgen_Settings__c settings = Docgen_Settings__c.getInstance();
        if (settings != null && String.isNotBlank(settings.Named_Credential_Name__c)) {
            return settings.Named_Credential_Name__c;
        }
        return 'Docgen_Node_API'; // Default to production Named Credential
    }

    /**
     * Get system readiness status from /readyz endpoint
     * @return Map containing ready status and individual checks
     */
    @AuraEnabled
    public static Map<String, Object> getSystemStatus() {
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:' + getNamedCredentialName() + '/readyz');
            req.setMethod('GET');
            req.setTimeout(TIMEOUT_MS);

            Http http = new Http();
            HTTPResponse res = http.send(req);

            if (res.getStatusCode() == 200 || res.getStatusCode() == 503) {
                return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            } else {
                throw new CustomException('Readiness check failed with status: ' + res.getStatusCode());
            }
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get system status: ' + e.getMessage());
        }
    }

    /**
     * Get worker status from /worker/status endpoint
     *
     * NOTE: In multi-replica deployments (Azure Container Apps), status is per-replica.
     * The poller runs automatically on all replicas. Results may vary depending on which
     * replica handles this request.
     *
     * @return Map containing isRunning, currentQueueDepth, lastPollTime
     */
    @AuraEnabled
    public static Map<String, Object> getWorkerStatus() {
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:' + getNamedCredentialName() + '/worker/status');
            req.setMethod('GET');
            req.setTimeout(TIMEOUT_MS);

            Http http = new Http();
            HTTPResponse res = http.send(req);

            if (res.getStatusCode() == 200) {
                return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            } else {
                throw new CustomException('Worker status check failed with status: ' + res.getStatusCode());
            }
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get worker status: ' + e.getMessage());
        }
    }

    /**
     * Get worker statistics from /worker/stats endpoint
     *
     * NOTE: In multi-replica deployments (Azure Container Apps), statistics are per-replica.
     * The poller runs automatically on all replicas. Results may vary depending on which
     * replica handles this request.
     *
     * @return Map containing totalProcessed, totalSucceeded, totalFailed, totalRetries, uptimeSeconds
     */
    @AuraEnabled
    public static Map<String, Object> getWorkerStats() {
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:' + getNamedCredentialName() + '/worker/stats');
            req.setMethod('GET');
            req.setTimeout(TIMEOUT_MS);

            Http http = new Http();
            HTTPResponse res = http.send(req);

            if (res.getStatusCode() == 200) {
                return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            } else {
                throw new CustomException('Worker stats check failed with status: ' + res.getStatusCode());
            }
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get worker stats: ' + e.getMessage());
        }
    }

    /**
     * Get queue metrics from Salesforce (last 24 hours)
     * @return Map containing counts by status, success rate, and trends
     */
    @AuraEnabled
    public static Map<String, Object> getQueueMetrics() {
        try {
            Datetime last24Hours = Datetime.now().addHours(-HOURS_FOR_METRICS);

            // Aggregate by status
            List<AggregateResult> statusCounts = [
                SELECT Status__c status, COUNT(Id) cnt
                FROM Generated_Document__c
                WHERE CreatedDate >= :last24Hours
                GROUP BY Status__c
            ];

            Map<String, Integer> countsByStatus = new Map<String, Integer>{
                'QUEUED' => 0,
                'PROCESSING' => 0,
                'SUCCEEDED' => 0,
                'FAILED' => 0,
                'CANCELED' => 0
            };

            Integer total = 0;
            for (AggregateResult ar : statusCounts) {
                String status = (String) ar.get('status');
                Integer count = (Integer) ar.get('cnt');
                countsByStatus.put(status, count);
                total += count;
            }

            // Calculate success rate
            Integer succeeded = countsByStatus.get('SUCCEEDED');
            Integer failed = countsByStatus.get('FAILED');
            Integer completed = succeeded + failed;
            Decimal successRate = completed > 0 ? (Decimal.valueOf(succeeded) / Decimal.valueOf(completed) * 100).setScale(1) : null;

            // Current backlog includes documents created before the reporting window.
            Map<String, Integer> backlog = new Map<String, Integer>{'QUEUED' => 0, 'PROCESSING' => 0};
            for (AggregateResult ar : [
                SELECT Status__c status, COUNT(Id) cnt
                FROM Generated_Document__c
                WHERE Status__c IN ('QUEUED', 'PROCESSING')
                GROUP BY Status__c
            ]) {
                backlog.put((String) ar.get('status'), (Integer) ar.get('cnt'));
            }
            Integer queueDepth = backlog.get('QUEUED') + backlog.get('PROCESSING');

            // Get retry count
            Integer retryCount = [
                SELECT COUNT()
                FROM Generated_Document__c
                WHERE CreatedDate >= :last24Hours
                AND Attempts__c > 1
            ];

            return new Map<String, Object>{
                'total' => total,
                'queued' => countsByStatus.get('QUEUED'),
                'processing' => countsByStatus.get('PROCESSING'),
                'succeeded' => succeeded,
                'failed' => failed,
                'canceled' => countsByStatus.get('CANCELED'),
                'successRate' => successRate,
                'queueDepth' => queueDepth,
                'currentQueued' => backlog.get('QUEUED'),
                'currentProcessing' => backlog.get('PROCESSING'),
                'retries' => retryCount
            };
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get queue metrics: ' + e.getMessage());
        }
    }

    /**
     * Get recent Generated_Document__c records
     * @return List of recent documents with key fields
     */
    @AuraEnabled
    public static List<GeneratedDocumentInfo> getRecentDocuments() {
        try {
            List<GeneratedDocumentInfo> results = new List<GeneratedDocumentInfo>();

            List<Generated_Document__c> docs = [
                SELECT Id, Name, Template__r.Name, Status__c,
                       CreatedDate, Error__c, OutputFormat__c,
                       Attempts__c, RequestedBy__r.Name
                FROM Generated_Document__c
                ORDER BY CreatedDate DESC, Id DESC
                LIMIT :RECENT_DOCUMENTS_LIMIT
            ];

            for (Generated_Document__c doc : docs) {
                GeneratedDocumentInfo info = new GeneratedDocumentInfo();
                info.id = doc.Id;
                info.name = doc.Name;
                info.templateName = doc.Template__r.Name;
                info.status = doc.Status__c;
                info.createdDate = doc.CreatedDate;
                info.error = doc.Error__c;
                info.outputFormat = doc.OutputFormat__c;
                info.attempts = Integer.valueOf(doc.Attempts__c);
                info.requestedBy = doc.RequestedBy__r?.Name;
                results.add(info);
            }

            return results;
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get recent documents: ' + e.getMessage());
        }
    }

    /**
     * Call a backend metrics endpoint and return the parsed JSON body
     *
     * @param path Endpoint path, e.g. '/metrics/performance'
     * @param label Human-readable name used in error messages
     */
    private static Map<String, Object> callBackend(String path, String label) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:' + getNamedCredentialName() + path);
        req.setMethod('GET');
        req.setTimeout(TIMEOUT_MS);

        HTTPResponse res = new Http().send(req);

        if (res.getStatusCode() != 200) {
            throw new CustomException(label + ' request failed with status: ' + res.getStatusCode());
        }

        return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
    }

    /**
     * Get processing time, throughput and per-stage timings from /metrics/performance
     *
     * NOTE: Per-replica and in-memory. The callout lands on one of the backend
     * replicas, and its samples cover a rolling window since that replica started.
     * Org-wide volume comes from getUsageMetrics() instead.
     *
     * Cannot be cacheable: Apex disallows callouts from cacheable methods.
     *
     * @return Map with documents (count, throughput, latency percentiles) and stages
     */
    @AuraEnabled
    public static Map<String, Object> getPerformanceMetrics() {
        try {
            return callBackend('/metrics/performance', 'Performance metrics');
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get performance metrics: ' + e.getMessage());
        }
    }

    /**
     * Get CPU, memory, LibreOffice pool and template cache usage from /metrics/resources
     *
     * NOTE: Per-replica by nature - CPU, memory, pool slots and cache contents are
     * properties of a single container instance.
     *
     * @return Map with cpu, memory, eventLoopDelayMs, libreOfficePool, templateCache
     */
    @AuraEnabled
    public static Map<String, Object> getResourceMetrics() {
        try {
            return callBackend('/metrics/resources', 'Resource metrics');
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get resource metrics: ' + e.getMessage());
        }
    }

    /**
     * Get org-wide document volume from Salesforce (complete across all replicas)
     *
     * Hour buckets use UTC keys and user-timezone labels, including partial edge hours.
     * Intentionally not cacheable: an imperative call to a
     * cacheable method is served from the client cache, which would make Refresh a
     * no-op on a page whose whole purpose is live data.
     *
     * @return Map with volume counts, hourly buckets, format split and top templates
     */
    @AuraEnabled
    public static Map<String, Object> getUsageMetrics() {
        try {
            Datetime nowTime = Datetime.now();
            Datetime last24Hours = nowTime.addHours(-HOURS_FOR_METRICS);

            // UTC hour keys keep repeated daylight-saving hours distinct; labels use the user timezone.
            Map<String, Integer> countsByHour = new Map<String, Integer>();
            for (AggregateResult ar : [
                SELECT DAY_ONLY(CreatedDate) utcDay,
                       HOUR_IN_DAY(CreatedDate) utcHour,
                       COUNT(Id) cnt
                FROM Generated_Document__c
                WHERE CreatedDate >= :last24Hours
                GROUP BY DAY_ONLY(CreatedDate),
                         HOUR_IN_DAY(CreatedDate)
            ]) {
                String key = String.valueOf((Date) ar.get('utcDay')) + '#' + String.valueOf(ar.get('utcHour'));
                countsByHour.put(key, (Integer) ar.get('cnt'));
            }

            // A rolling 24-hour window intersects 25 clock hours, including both partial edges.
            List<Map<String, Object>> hourly = new List<Map<String, Object>>();
            Integer peakCount = 0;
            String peakLabel = null;
            for (Integer i = HOURS_FOR_METRICS; i >= 0; i--) {
                Datetime slot = nowTime.addHours(-i);
                String key = slot.formatGmt('yyyy-MM-dd') + '#' + slot.formatGmt('H');
                Integer count = countsByHour.containsKey(key) ? countsByHour.get(key) : 0;
                Datetime hourStart = Datetime.newInstanceGmt(slot.dateGmt(), Time.newInstance(slot.hourGmt(), 0, 0, 0));
                String label = hourStart.format('EEE HH:mm z');

                hourly.add(new Map<String, Object>{ 'label' => label, 'count' => count });

                if (count > peakCount) {
                    peakCount = count;
                    peakLabel = label;
                }
            }

            // Volume by output format
            List<Map<String, Object>> byFormat = new List<Map<String, Object>>();
            for (AggregateResult ar : [
                SELECT OutputFormat__c fmt, COUNT(Id) cnt
                FROM Generated_Document__c
                WHERE CreatedDate >= :last24Hours
                GROUP BY OutputFormat__c
                ORDER BY COUNT(Id) DESC
            ]) {
                byFormat.add(new Map<String, Object>{
                    'format' => ar.get('fmt') == null ? 'Unknown' : (String) ar.get('fmt'),
                    'count' => (Integer) ar.get('cnt')
                });
            }

            // Busiest templates
            List<Map<String, Object>> topTemplates = new List<Map<String, Object>>();
            for (AggregateResult ar : [
                SELECT Template__r.Name templateName, COUNT(Id) cnt
                FROM Generated_Document__c
                WHERE CreatedDate >= :last24Hours AND Template__c != null
                GROUP BY Template__r.Name
                ORDER BY COUNT(Id) DESC
                LIMIT :TOP_TEMPLATES_LIMIT
            ]) {
                topTemplates.add(new Map<String, Object>{
                    'templateName' => ar.get('templateName') == null ? 'Unknown' : (String) ar.get('templateName'),
                    'count' => (Integer) ar.get('cnt')
                });
            }

            Datetime lastHourStart = nowTime.addHours(-1);
            Datetime last7DaysStart = nowTime.addDays(-7);

            Integer lastHour = [
                SELECT COUNT()
                FROM Generated_Document__c
                WHERE CreatedDate >= :lastHourStart
            ];
            Integer last7Days = [
                SELECT COUNT()
                FROM Generated_Document__c
                WHERE CreatedDate >= :last7DaysStart
            ];
            Integer last24 = 0;
            for (Map<String, Object> bucket : hourly) {
                last24 += (Integer) bucket.get('count');
            }

            return new Map<String, Object>{
                'lastHour' => lastHour,
                'last24Hours' => last24,
                'last7Days' => last7Days,
                'perHourAverage' => (Decimal.valueOf(last24) / HOURS_FOR_METRICS).setScale(1),
                'peakHourLabel' => peakLabel,
                'peakHourCount' => peakCount,
                'hourly' => hourly,
                'byFormat' => byFormat,
                'topTemplates' => topTemplates
            };
        } catch (Exception e) {
            throw new AuraHandledException('Failed to get usage metrics: ' + e.getMessage());
        }
    }

    /**
     * Wrapper class for Generated Document information
     */
    public class GeneratedDocumentInfo {
        @AuraEnabled public String id { get; set; }
        @AuraEnabled public String name { get; set; }
        @AuraEnabled public String templateName { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public Datetime createdDate { get; set; }
        @AuraEnabled public String error { get; set; }
        @AuraEnabled public String outputFormat { get; set; }
        @AuraEnabled public Integer attempts { get; set; }
        @AuraEnabled public String requestedBy { get; set; }
    }

    /**
     * Custom exception for HTTP callout failures
     */
    public class CustomException extends Exception {}
}
