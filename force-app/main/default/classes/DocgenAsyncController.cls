/**
 * Controller for queued document generation with client-side progress polling.
 */
public with sharing class DocgenAsyncController {
    private static final Set<String> VALID_OUTPUT_FORMATS = new Set<String>{'PDF', 'DOCX', 'PPTX'};

    public class StartResult {
        @AuraEnabled public String generatedDocumentId { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public Integer progressValue { get; set; }
        @AuraEnabled public Boolean isTerminal { get; set; }
        @AuraEnabled public String downloadUrl { get; set; }
        @AuraEnabled public String errorMessage { get; set; }
        @AuraEnabled public String correlationId { get; set; }
        @AuraEnabled public String outputFormat { get; set; }
    }

    public class StatusResult {
        @AuraEnabled public String generatedDocumentId { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public Integer progressValue { get; set; }
        @AuraEnabled public Boolean isTerminal { get; set; }
        @AuraEnabled public String downloadUrl { get; set; }
        @AuraEnabled public String errorMessage { get; set; }
        @AuraEnabled public String correlationId { get; set; }
        @AuraEnabled public String outputFormat { get; set; }
    }

    @AuraEnabled
    public static StartResult startGeneration(Id templateId, String templateName, Id recordId, String outputFormat) {
        try {
            if (recordId == null) {
                throw new IllegalArgumentException('Record ID is required');
            }

            String normalizedOutputFormat = normalizeOutputFormat(outputFormat);
            Docgen_Template__c template = queryTemplate(templateId, templateName);

            DocgenEnvelopeService.Envelope envelope = DocgenEnvelopeService.build(
                recordId,
                template,
                normalizedOutputFormat,
                'en-GB',
                'Europe/London'
            );

            Generated_Document__c existingDoc = findExistingDocument(envelope.requestHash);
            if (existingDoc != null) {
                if (existingDoc.Status__c == 'FAILED' || existingDoc.Status__c == 'CANCELED') {
                    String retryCorrelationId = generateCorrelationId();
                    requeueDocument(existingDoc.Id, template.Id, recordId, envelope, retryCorrelationId);
                    return toStartResult(queryGeneratedDocument(existingDoc.Id));
                }
                return toStartResult(existingDoc);
            }

            Generated_Document__c doc = createQueuedDocument(
                template.Id,
                recordId,
                envelope,
                generateCorrelationId()
            );
            return toStartResult(doc);
        } catch (Exception e) {
            throwAuraException(e.getMessage());
            return null;
        }
    }

    @AuraEnabled
    public static StatusResult getGenerationStatus(Id generatedDocumentId) {
        try {
            if (generatedDocumentId == null) {
                throw new IllegalArgumentException('Generated Document ID is required');
            }

            return toStatusResult(queryGeneratedDocument(generatedDocumentId));
        } catch (Exception e) {
            throwAuraException(e.getMessage());
            return null;
        }
    }

    private static String normalizeOutputFormat(String outputFormat) {
        String normalized = String.isBlank(outputFormat) ? 'PDF' : outputFormat.trim().toUpperCase();
        if (!VALID_OUTPUT_FORMATS.contains(normalized)) {
            throw new IllegalArgumentException('Output Format must be PDF, DOCX, or PPTX');
        }
        return normalized;
    }

    private static Docgen_Template__c queryTemplate(Id templateId, String templateName) {
        if (templateId == null && String.isBlank(templateName)) {
            throw new IllegalArgumentException('Template ID or Template Name is required');
        }

        List<Docgen_Template__c> templates;
        if (templateId != null) {
            templates = [
                SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                       ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                       ReturnMultipleRecords__c, Output_File_Name_Field__c,
                       Watermark_Text__c, Watermark_Condition_Field__c
                FROM Docgen_Template__c
                WHERE Id = :templateId
                LIMIT 1
            ];
        } else {
            templates = [
                SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                       ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                       ReturnMultipleRecords__c, Output_File_Name_Field__c,
                       Watermark_Text__c, Watermark_Condition_Field__c
                FROM Docgen_Template__c
                WHERE Name = :templateName
                LIMIT 1
            ];
        }

        if (templates.isEmpty()) {
            String identifier = templateId != null ? String.valueOf(templateId) : templateName;
            throw new IllegalArgumentException('Template not found: ' + identifier);
        }

        return templates[0];
    }

    private static Generated_Document__c findExistingDocument(String requestHash) {
        List<Generated_Document__c> existing = [
            SELECT Id, Status__c, OutputFileId__c, MergedDocxFileId__c, Error__c,
                   CorrelationId__c, OutputFormat__c
            FROM Generated_Document__c
            WHERE RequestHash__c = :requestHash
            LIMIT 1
        ];
        return existing.isEmpty() ? null : existing[0];
    }

    private static Generated_Document__c queryGeneratedDocument(Id generatedDocumentId) {
        return [
            SELECT Id, Status__c, OutputFileId__c, MergedDocxFileId__c, Error__c,
                   CorrelationId__c, OutputFormat__c
            FROM Generated_Document__c
            WHERE Id = :generatedDocumentId
            LIMIT 1
        ];
    }

    private static Generated_Document__c createQueuedDocument(
        Id templateId,
        Id recordId,
        DocgenEnvelopeService.Envelope envelope,
        String correlationId
    ) {
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = envelope.requestHash,
            Status__c = 'QUEUED',
            OutputFormat__c = envelope.outputFormat,
            Priority__c = 0,
            Attempts__c = 0,
            RequestedBy__c = UserInfo.getUserId(),
            CorrelationId__c = correlationId
        );
        DocgenEnvelopeService.setRequestJSONSegments(doc, DocgenEnvelopeService.toJSON(envelope));
        setParentLookups(doc, recordId, envelope.parents);

        insert doc;
        return doc;
    }

    private static void requeueDocument(
        Id generatedDocumentId,
        Id templateId,
        Id recordId,
        DocgenEnvelopeService.Envelope envelope,
        String correlationId
    ) {
        Generated_Document__c retryDoc = new Generated_Document__c(
            Id = generatedDocumentId,
            Template__c = templateId,
            RequestHash__c = envelope.requestHash,
            Status__c = 'QUEUED',
            OutputFormat__c = envelope.outputFormat,
            Priority__c = 0,
            Attempts__c = 0,
            RequestedBy__c = UserInfo.getUserId(),
            CorrelationId__c = correlationId,
            Error__c = null,
            OutputFileId__c = null,
            MergedDocxFileId__c = null,
            LockedUntil__c = null,
            ScheduledRetryTime__c = null
        );
        DocgenEnvelopeService.setRequestJSONSegments(retryDoc, DocgenEnvelopeService.toJSON(envelope));
        setParentLookups(retryDoc, recordId, envelope.parents);

        update retryDoc;
    }

    private static void setParentLookups(Generated_Document__c doc, Id recordId, Map<String, String> parents) {
        String objectApiName = recordId.getSObjectType().getDescribe().getName();
        DocgenObjectConfigService.validateObjectSupported(objectApiName);
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject(objectApiName);
        putConfiguredParentLookup(doc, config, recordId);

        if (parents == null || parents.isEmpty()) {
            return;
        }

        for (String parentKey : parents.keySet()) {
            String parentIdValue = parents.get(parentKey);
            if (String.isBlank(parentIdValue)) {
                continue;
            }

            String parentObjectName = parentKey.endsWith('Id')
                ? parentKey.substring(0, parentKey.length() - 2)
                : parentKey;
            if (!DocgenObjectConfigService.isObjectSupported(parentObjectName)) {
                continue;
            }

            Supported_Object__mdt parentConfig = DocgenObjectConfigService.getConfigForObject(parentObjectName);
            putConfiguredParentLookup(doc, parentConfig, (Id) parentIdValue);
        }
    }

    private static void putConfiguredParentLookup(
        Generated_Document__c doc,
        Supported_Object__mdt config,
        Id parentId
    ) {
        if (doc == null || config == null || parentId == null || String.isBlank(config.Lookup_Field_API_Name__c)) {
            return;
        }

        if (!generatedDocumentFieldExists(config.Lookup_Field_API_Name__c)) {
            System.debug(
                LoggingLevel.WARN,
                'Generated_Document__c lookup field is not installed: ' + config.Lookup_Field_API_Name__c
            );
            return;
        }

        doc.put(config.Lookup_Field_API_Name__c, parentId);
    }

    private static Boolean generatedDocumentFieldExists(String fieldApiName) {
        return Generated_Document__c.SObjectType.getDescribe().fields.getMap().containsKey(fieldApiName);
    }

    private static StartResult toStartResult(Generated_Document__c doc) {
        StatusResult status = toStatusResult(doc);
        StartResult result = new StartResult();
        result.generatedDocumentId = status.generatedDocumentId;
        result.status = status.status;
        result.progressValue = status.progressValue;
        result.isTerminal = status.isTerminal;
        result.downloadUrl = status.downloadUrl;
        result.errorMessage = status.errorMessage;
        result.correlationId = status.correlationId;
        result.outputFormat = status.outputFormat;
        return result;
    }

    private static StatusResult toStatusResult(Generated_Document__c doc) {
        StatusResult result = new StatusResult();
        result.generatedDocumentId = doc.Id;
        result.status = doc.Status__c;
        result.progressValue = progressForStatus(doc.Status__c);
        result.isTerminal = isTerminalStatus(doc.Status__c);
        result.errorMessage = doc.Error__c;
        result.correlationId = doc.CorrelationId__c;
        result.outputFormat = doc.OutputFormat__c;

        if (doc.Status__c == 'SUCCEEDED' && String.isNotBlank(doc.OutputFileId__c)) {
            result.downloadUrl = buildDownloadUrl(doc.OutputFileId__c);
        }

        return result;
    }

    private static Integer progressForStatus(String status) {
        if (status == 'QUEUED') {
            return 20;
        }
        if (status == 'PROCESSING') {
            return 60;
        }
        if (status == 'SUCCEEDED') {
            return 100;
        }
        if (status == 'FAILED' || status == 'CANCELED') {
            return 100;
        }
        return 10;
    }

    private static Boolean isTerminalStatus(String status) {
        return status == 'SUCCEEDED' || status == 'FAILED' || status == 'CANCELED';
    }

    private static String buildDownloadUrl(String contentVersionId) {
        if (String.isBlank(contentVersionId)) {
            return null;
        }

        if (Test.isRunningTest()) {
            String mockDocId = contentVersionId;
            if (mockDocId.startsWith('068')) {
                mockDocId = '069' + mockDocId.substring(3);
            }
            return '/lightning/r/ContentDocument/' + mockDocId + '/view';
        }

        List<ContentVersion> versions = [
            SELECT ContentDocumentId
            FROM ContentVersion
            WHERE Id = :contentVersionId
            LIMIT 1
        ];

        if (versions.isEmpty()) {
            throw new AuraHandledException('Content version not found: ' + contentVersionId);
        }

        return '/lightning/r/ContentDocument/' + versions[0].ContentDocumentId + '/view';
    }

    private static String generateCorrelationId() {
        Blob b = Crypto.generateAESKey(128);
        String hex = EncodingUtil.convertToHex(b);
        String guid = hex.substring(0, 8) + '-' +
            hex.substring(8, 12) + '-' +
            '4' + hex.substring(13, 16) + '-' +
            hex.substring(16, 20) + '-' +
            hex.substring(20, 32);
        return guid.toLowerCase();
    }

    private static void throwAuraException(String message) {
        AuraHandledException ex = new AuraHandledException(message);
        ex.setMessage(message);
        throw ex;
    }
}
