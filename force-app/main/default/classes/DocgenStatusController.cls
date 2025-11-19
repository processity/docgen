/**
 * Controller for the Docgen Status page
 * Provides system health, worker status, queue metrics, and worker control
 */
public with sharing class DocgenStatusController {

    private static final Integer TIMEOUT_MS = 30000; // 30 seconds
    private static final Integer RECENT_DOCUMENTS_LIMIT = 50;
    private static final Integer HOURS_FOR_METRICS = 24;

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
    @AuraEnabled(cacheable=true)
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
            Decimal successRate = completed > 0 ? (Decimal.valueOf(succeeded) / Decimal.valueOf(completed) * 100).setScale(1) : 0;

            // Get current queue depth (QUEUED + PROCESSING)
            Integer queueDepth = countsByStatus.get('QUEUED') + countsByStatus.get('PROCESSING');

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
    @AuraEnabled(cacheable=true)
    public static List<GeneratedDocumentInfo> getRecentDocuments() {
        try {
            List<GeneratedDocumentInfo> results = new List<GeneratedDocumentInfo>();

            List<Generated_Document__c> docs = [
                SELECT Id, Name, Template__r.Name, Status__c,
                       CreatedDate, Error__c, OutputFormat__c,
                       Attempts__c, RequestedBy__r.Name
                FROM Generated_Document__c
                ORDER BY CreatedDate DESC
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
