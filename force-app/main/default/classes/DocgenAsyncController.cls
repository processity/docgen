/**
 * Controller for queued document generation with client-side progress polling.
 */
public with sharing class DocgenAsyncController {
    private static final Integer MAX_INLINE_PREVIEW_BYTES = 2500000;
    private static final Integer MAX_PDF_PREVIEW_PAGES = 20;

    public class StartResult {
        @AuraEnabled public String generatedDocumentId { get; set; }
        @AuraEnabled public String status { get; set; }
        @AuraEnabled public Integer progressValue { get; set; }
        @AuraEnabled public Boolean isTerminal { get; set; }
        @AuraEnabled public String downloadUrl { get; set; }
        @AuraEnabled public String errorMessage { get; set; }
        @AuraEnabled public String correlationId { get; set; }
        @AuraEnabled public String outputFormat { get; set; }
        @AuraEnabled public String contentVersionId { get; set; }
        @AuraEnabled public String contentDocumentId { get; set; }
        @AuraEnabled public String previewUrl { get; set; }
        @AuraEnabled public Boolean canInlinePreview { get; set; }
        @AuraEnabled public Boolean isPreviewPending { get; set; }
        @AuraEnabled public String attachmentWarnings { get; set; }
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
        @AuraEnabled public String contentVersionId { get; set; }
        @AuraEnabled public String contentDocumentId { get; set; }
        @AuraEnabled public String previewUrl { get; set; }
        @AuraEnabled public Boolean canInlinePreview { get; set; }
        @AuraEnabled public Boolean isPreviewPending { get; set; }
        @AuraEnabled public String attachmentWarnings { get; set; }
    }

    public class PreviewContent {
        @AuraEnabled public String contentType { get; set; }
        @AuraEnabled public String base64Data { get; set; }
        @AuraEnabled public String fileName { get; set; }
    }

    public class PdfPreviewPage {
        @AuraEnabled public String contentType { get; set; }
        @AuraEnabled public String base64Data { get; set; }
        @AuraEnabled public Integer pageNumber { get; set; }
        @AuraEnabled public Integer pageCount { get; set; }
        @AuraEnabled public Integer previewPageCount { get; set; }
        @AuraEnabled public Boolean previewTruncated { get; set; }
    }

    public static StartResult startGeneration(Id templateId, String templateName, Id recordId, String outputFormat) {
        return startGeneration(templateId, templateName, recordId, outputFormat, false, false);
    }

    public static StartResult startGeneration(
        Id templateId,
        String templateName,
        Id recordId,
        String outputFormat,
        Boolean previewMode
    ) {
        return startGeneration(templateId, templateName, recordId, outputFormat, previewMode, false);
    }

    @AuraEnabled
    public static StartResult startGeneration(
        Id templateId,
        String templateName,
        Id recordId,
        String outputFormat,
        Boolean previewMode,
        Boolean readOnlyWord,
        List<Id> additionalPdfContentVersionIds
    ) {
        try {
            if (recordId == null) {
                throw new IllegalArgumentException('Record ID is required');
            }

            Docgen_Template__c template = queryTemplate(templateId, templateName);
            String normalizedOutputFormat = DocgenEnvelopeService.resolveOutputFormat(
                outputFormat,
                template.Default_Output_Format__c
            );
            Boolean isPreviewMode = previewMode == true;
            String correlationId = generateCorrelationId();

            DocgenEnvelopeService.Envelope envelope = DocgenEnvelopeService.build(
                recordId,
                template,
                normalizedOutputFormat,
                'en-GB',
                'Europe/London',
                readOnlyWord,
                additionalPdfContentVersionIds
            );

            if (isPreviewMode) {
                envelope.requestHash = buildPreviewRequestHash(envelope.requestHash, correlationId);
            }

            Generated_Document__c existingDoc = isPreviewMode ? null : findExistingDocument(envelope.requestHash);
            if (existingDoc != null) {
                if (existingDoc.Status__c == 'FAILED' || existingDoc.Status__c == 'CANCELED') {
                    requeueDocument(existingDoc.Id, template.Id, recordId, envelope, correlationId);
                    return toStartResult(queryGeneratedDocument(existingDoc.Id));
                }
                return toStartResult(existingDoc);
            }

            Generated_Document__c doc = createQueuedDocument(
                template.Id,
                recordId,
                envelope,
                correlationId,
                isPreviewMode
            );
            return toStartResult(doc);
        } catch (Exception e) {
            throwAuraException(e.getMessage());
            return null;
        }
    }

    public static StartResult startGeneration(
        Id templateId,
        String templateName,
        Id recordId,
        String outputFormat,
        Boolean previewMode,
        Boolean readOnlyWord
    ) {
        return startGeneration(
            templateId,
            templateName,
            recordId,
            outputFormat,
            previewMode,
            readOnlyWord,
            (List<Id>) null
        );
    }

    public static StartResult startGeneration(
        Id templateId,
        String templateName,
        Id recordId,
        String outputFormat,
        Boolean previewMode,
        Boolean readOnlyWord,
        Set<Id> additionalPdfContentVersionIds
    ) {
        return startGeneration(
            templateId,
            templateName,
            recordId,
            outputFormat,
            previewMode,
            readOnlyWord,
            DocgenAttachmentService.sortSet(additionalPdfContentVersionIds)
        );
    }

    public static StartResult startCompositeGeneration(
        Id compositeDocumentId,
        String recordIds,
        String outputFormat,
        Boolean previewMode
    ) {
        return startCompositeGeneration(compositeDocumentId, recordIds, outputFormat, previewMode, false);
    }

    @AuraEnabled
    public static StartResult startCompositeGeneration(
        Id compositeDocumentId,
        String recordIds,
        String outputFormat,
        Boolean previewMode,
        Boolean readOnlyWord,
        List<Id> additionalPdfContentVersionIds
    ) {
        try {
            if (compositeDocumentId == null) {
                throw new IllegalArgumentException('Composite Document ID is required');
            }

            Map<String, Id> recordIdsMap = parseRecordIds(recordIds);
            String correlationId = generateCorrelationId();
            Boolean isPreviewMode = previewMode == true;

            DocgenEnvelopeService.Envelope envelope = DocgenEnvelopeService.buildForComposite(
                compositeDocumentId,
                recordIdsMap,
                outputFormat,
                'en-GB',
                'Europe/London',
                readOnlyWord,
                additionalPdfContentVersionIds
            );

            if (isPreviewMode) {
                envelope.requestHash = buildPreviewRequestHash(envelope.requestHash, correlationId);
            }

            Generated_Document__c existingDoc = isPreviewMode ? null : findExistingDocument(envelope.requestHash);
            if (existingDoc != null) {
                if (existingDoc.Status__c == 'FAILED' || existingDoc.Status__c == 'CANCELED') {
                    requeueCompositeDocument(
                        existingDoc.Id,
                        compositeDocumentId,
                        recordIdsMap,
                        envelope,
                        correlationId
                    );
                    return toStartResult(queryGeneratedDocument(existingDoc.Id));
                }
                return toStartResult(existingDoc);
            }

            Generated_Document__c doc = createQueuedCompositeDocument(
                compositeDocumentId,
                recordIdsMap,
                envelope,
                correlationId,
                isPreviewMode
            );
            return toStartResult(doc);
        } catch (Exception e) {
            throwAuraException(e.getMessage());
            return null;
        }
    }

    public static StartResult startCompositeGeneration(
        Id compositeDocumentId,
        String recordIds,
        String outputFormat,
        Boolean previewMode,
        Boolean readOnlyWord
    ) {
        return startCompositeGeneration(
            compositeDocumentId,
            recordIds,
            outputFormat,
            previewMode,
            readOnlyWord,
            (List<Id>) null
        );
    }

    public static StartResult startCompositeGeneration(
        Id compositeDocumentId,
        String recordIds,
        String outputFormat,
        Boolean previewMode,
        Boolean readOnlyWord,
        Set<Id> additionalPdfContentVersionIds
    ) {
        return startCompositeGeneration(
            compositeDocumentId,
            recordIds,
            outputFormat,
            previewMode,
            readOnlyWord,
            DocgenAttachmentService.sortSet(additionalPdfContentVersionIds)
        );
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

    @AuraEnabled
    public static PreviewContent getPdfPreviewContent(Id generatedDocumentId) {
        try {
            if (generatedDocumentId == null) {
                throw new IllegalArgumentException('Generated Document ID is required');
            }

            Generated_Document__c doc = [
                SELECT Id, Status__c, OutputFileId__c, OutputFormat__c, PendingPreview__c, RequestedBy__c
                FROM Generated_Document__c
                WHERE Id = :generatedDocumentId
                LIMIT 1
            ];

            if (doc.Status__c != 'SUCCEEDED') {
                throw new IllegalArgumentException('Only successfully generated documents can be previewed.');
            }
            if (doc.OutputFormat__c != 'PDF') {
                throw new IllegalArgumentException('Only PDF documents can be previewed inline.');
            }
            if (String.isBlank(doc.OutputFileId__c)) {
                throw new IllegalArgumentException('Generated document does not have a PDF file.');
            }
            if (doc.PendingPreview__c) {
                throw new IllegalArgumentException('The complete PDF is unavailable until the preview is saved.');
            }

            ContentVersion version = [
                SELECT Title, FileExtension, ContentSize, VersionData
                FROM ContentVersion
                WHERE Id = :doc.OutputFileId__c
                LIMIT 1
            ];

            if (version.ContentSize != null && version.ContentSize > MAX_INLINE_PREVIEW_BYTES) {
                throw new IllegalArgumentException('PDF is too large for inline preview. Open the generated file instead.');
            }

            PreviewContent content = new PreviewContent();
            content.contentType = 'application/pdf';
            content.base64Data = EncodingUtil.base64Encode(version.VersionData);
            content.fileName = buildFileName(version.Title, version.FileExtension);
            return content;
        } catch (Exception e) {
            throwAuraException(e.getMessage());
            return null;
        }
    }

    @AuraEnabled
    public static PdfPreviewPage getPdfPreviewPage(Id generatedDocumentId, Integer pageNumber) {
        try {
            validatePdfPreviewRequest(generatedDocumentId, pageNumber);
            Generated_Document__c doc = queryGeneratedDocument(generatedDocumentId);

            if (doc.Status__c != 'SUCCEEDED') {
                throw new IllegalArgumentException('Only successfully generated documents can be previewed.');
            }
            if (!doc.PendingPreview__c) {
                throw new IllegalArgumentException('Only pending preview documents can request rendered pages.');
            }
            if (doc.OutputFormat__c != 'PDF') {
                throw new IllegalArgumentException('Only PDF documents support page preview.');
            }
            if (String.isBlank(doc.OutputFileId__c)) {
                throw new IllegalArgumentException('Generated document does not have a PDF file.');
            }
            if (doc.RequestedBy__c != UserInfo.getUserId()) {
                throw new IllegalArgumentException('Only the requesting user can preview this pending document.');
            }

            if (doc.Preview_Page_Count__c == null || doc.Preview_Page_Count__c < 1) {
                throw new IllegalArgumentException('PDF preview page metadata is unavailable. Generate the document again.');
            }

            DocgenPreviewFileStore.PreviewPageFile storedPage =
                DocgenPreviewFileStore.loadPreviewPage(
                    doc.Preview_Page_File_Ids__c,
                    pageNumber,
                    MAX_PDF_PREVIEW_PAGES,
                    MAX_INLINE_PREVIEW_BYTES
                );
            Integer pageCount = doc.Preview_Page_Count__c.intValue();
            if (pageCount < storedPage.previewPageCount) {
                throw new IllegalArgumentException('PDF preview page metadata is invalid. Generate the document again.');
            }

            PdfPreviewPage page = new PdfPreviewPage();
            page.contentType = 'image/jpeg';
            page.base64Data = EncodingUtil.base64Encode(storedPage.data);
            page.pageNumber = pageNumber;
            page.pageCount = pageCount;
            page.previewPageCount = storedPage.previewPageCount;
            page.previewTruncated = pageCount > storedPage.previewPageCount;
            return page;
        } catch (Exception e) {
            throwAuraException(e.getMessage());
            return null;
        }
    }

    @AuraEnabled
    public static StatusResult saveGeneratedDocument(Id generatedDocumentId) {
        try {
            Generated_Document__c doc = queryGeneratedDocument(generatedDocumentId);
            if (doc.Status__c != 'SUCCEEDED') {
                throw new IllegalArgumentException('Only successfully generated documents can be saved.');
            }
            if (!doc.PendingPreview__c) {
                return toStatusResult(doc);
            }
            if (doc.RequestedBy__c != UserInfo.getUserId()) {
                throw new IllegalArgumentException('Only the requesting user can save this pending document.');
            }
            if (String.isBlank(doc.OutputFileId__c) && String.isBlank(doc.MergedDocxFileId__c)) {
                throw new IllegalArgumentException('Generated document does not have a file to save.');
            }

            ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(new List<Generated_Document__c>{ doc });
            deletePreviewFiles(doc);
            DocgenGeneratedDocumentWriter.updateTrackingRecord(new Generated_Document__c(
                Id = doc.Id,
                PendingPreview__c = false,
                Preview_Page_File_Ids__c = null,
                Preview_Page_Count__c = null
            ));

            return toStatusResult(queryGeneratedDocument(doc.Id));
        } catch (Exception e) {
            throwAuraException(e.getMessage());
            return null;
        }
    }

    @AuraEnabled
    public static void cancelGeneratedDocument(Id generatedDocumentId) {
        try {
            Generated_Document__c doc = queryGeneratedDocument(generatedDocumentId);
            if (!doc.PendingPreview__c) {
                throw new IllegalArgumentException('Only pending preview documents can be canceled.');
            }
            if (doc.RequestedBy__c != UserInfo.getUserId()) {
                throw new IllegalArgumentException('Only the requesting user can cancel this pending document.');
            }

            deleteGeneratedFiles(doc);
            delete doc;
        } catch (Exception e) {
            throwAuraException(e.getMessage());
        }
    }

    private static Docgen_Template__c queryTemplate(Id templateId, String templateName) {
        if (templateId == null && String.isBlank(templateName)) {
            throw new IllegalArgumentException('Template ID or Template Name is required');
        }

        Docgen_Template__c template = templateId != null
            ? DocgenTemplateConfigReader.loadTemplateById(templateId)
            : DocgenTemplateConfigReader.loadTemplateByName(templateName);

        if (template == null) {
            String identifier = templateId != null ? String.valueOf(templateId) : templateName;
            throw new IllegalArgumentException('Template not found: ' + identifier);
        }

        return template;
    }

    private static Generated_Document__c findExistingDocument(String requestHash) {
        List<Generated_Document__c> existing = [
            SELECT Id, Status__c, OutputFileId__c, MergedDocxFileId__c, Error__c,
                   CorrelationId__c, OutputFormat__c, PendingPreview__c, RequestedBy__c,
                   Attachment_Warnings__c, Preview_Page_File_Ids__c, Preview_Page_Count__c
            FROM Generated_Document__c
            WHERE RequestHash__c = :requestHash
            LIMIT 1
        ];
        return existing.isEmpty() ? null : existing[0];
    }

    private static Generated_Document__c queryGeneratedDocument(Id generatedDocumentId) {
        return [
            SELECT Id, Status__c, OutputFileId__c, MergedDocxFileId__c, Error__c,
                   CorrelationId__c, OutputFormat__c, PendingPreview__c, RequestedBy__c,
                   Attachment_Warnings__c, Preview_Page_File_Ids__c, Preview_Page_Count__c
            FROM Generated_Document__c
            WHERE Id = :generatedDocumentId
            LIMIT 1
        ];
    }

    private static Generated_Document__c createQueuedDocument(
        Id templateId,
        Id recordId,
        DocgenEnvelopeService.Envelope envelope,
        String correlationId,
        Boolean pendingPreview
    ) {
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            RequestHash__c = envelope.requestHash,
            Status__c = 'QUEUED',
            OutputFormat__c = envelope.outputFormat,
            Priority__c = 0,
            Attempts__c = 0,
            RequestedBy__c = UserInfo.getUserId(),
            CorrelationId__c = correlationId,
            Attachment_Warnings__c = DocgenAttachmentService.serializeWarnings(envelope.attachmentWarnings),
            PendingPreview__c = pendingPreview == true
        );
        DocgenEnvelopeService.setRequestJSONSegments(doc, DocgenEnvelopeService.toJSON(envelope));
        setParentLookups(doc, recordId, envelope.parents);

        DocgenGeneratedDocumentWriter.insertTrackingRecord(doc);
        return doc;
    }

    private static Generated_Document__c createQueuedCompositeDocument(
        Id compositeDocumentId,
        Map<String, Id> recordIds,
        DocgenEnvelopeService.Envelope envelope,
        String correlationId,
        Boolean pendingPreview
    ) {
        Generated_Document__c doc = new Generated_Document__c(
            Composite_Document__c = compositeDocumentId,
            RequestHash__c = envelope.requestHash,
            Status__c = 'QUEUED',
            OutputFormat__c = envelope.outputFormat,
            Priority__c = 0,
            Attempts__c = 0,
            RequestedBy__c = UserInfo.getUserId(),
            CorrelationId__c = correlationId,
            Attachment_Warnings__c = DocgenAttachmentService.serializeWarnings(envelope.attachmentWarnings),
            PendingPreview__c = pendingPreview == true
        );
        DocgenEnvelopeService.setRequestJSONSegments(doc, DocgenEnvelopeService.toJSON(envelope));
        setCompositeParentLookups(doc, compositeDocumentId, recordIds, envelope.parents);

        DocgenGeneratedDocumentWriter.insertTrackingRecord(doc);
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
            Attachment_Warnings__c = DocgenAttachmentService.serializeWarnings(envelope.attachmentWarnings),
            OutputFileId__c = null,
            MergedDocxFileId__c = null,
            Preview_Page_File_Ids__c = null,
            Preview_Page_Count__c = null,
            LockedUntil__c = null,
            ScheduledRetryTime__c = null,
            PendingPreview__c = false
        );
        DocgenEnvelopeService.setRequestJSONSegments(retryDoc, DocgenEnvelopeService.toJSON(envelope));
        setParentLookups(retryDoc, recordId, envelope.parents);

        DocgenGeneratedDocumentWriter.updateTrackingRecord(retryDoc);
    }

    private static void requeueCompositeDocument(
        Id generatedDocumentId,
        Id compositeDocumentId,
        Map<String, Id> recordIds,
        DocgenEnvelopeService.Envelope envelope,
        String correlationId
    ) {
        Generated_Document__c retryDoc = new Generated_Document__c(
            Id = generatedDocumentId,
            Composite_Document__c = compositeDocumentId,
            Template__c = null,
            RequestHash__c = envelope.requestHash,
            Status__c = 'QUEUED',
            OutputFormat__c = envelope.outputFormat,
            Priority__c = 0,
            Attempts__c = 0,
            RequestedBy__c = UserInfo.getUserId(),
            CorrelationId__c = correlationId,
            Error__c = null,
            Attachment_Warnings__c = DocgenAttachmentService.serializeWarnings(envelope.attachmentWarnings),
            OutputFileId__c = null,
            MergedDocxFileId__c = null,
            Preview_Page_File_Ids__c = null,
            Preview_Page_Count__c = null,
            LockedUntil__c = null,
            ScheduledRetryTime__c = null,
            PendingPreview__c = false
        );
        DocgenEnvelopeService.setRequestJSONSegments(retryDoc, DocgenEnvelopeService.toJSON(envelope));
        setCompositeParentLookups(retryDoc, compositeDocumentId, recordIds, envelope.parents);

        DocgenGeneratedDocumentWriter.updateTrackingRecord(retryDoc);
    }

    private static Map<String, Id> parseRecordIds(String recordIdsJson) {
        if (String.isBlank(recordIdsJson)) {
            throw new IllegalArgumentException('recordIds parameter is required');
        }

        try {
            Map<String, Object> rawMap = (Map<String, Object>) JSON.deserializeUntyped(recordIdsJson);
            Map<String, Id> recordIds = new Map<String, Id>();
            for (String key : rawMap.keySet()) {
                Object value = rawMap.get(key);
                if (value == null || String.isBlank(String.valueOf(value))) {
                    continue;
                }
                recordIds.put(key, (Id) String.valueOf(value));
            }

            if (recordIds.isEmpty()) {
                throw new IllegalArgumentException('At least one record ID is required');
            }

            return recordIds;
        } catch (Exception e) {
            throw new IllegalArgumentException('Invalid recordIds JSON format: ' + e.getMessage());
        }
    }

    private static void setCompositeParentLookups(
        Generated_Document__c doc,
        Id compositeDocumentId,
        Map<String, Id> recordIds,
        Map<String, String> parents
    ) {
        Id primaryRecordId = determineCompositePrimaryRecordId(compositeDocumentId, recordIds);
        if (primaryRecordId != null) {
            setConfiguredParentLookup(doc, primaryRecordId);
        }

        if (parents == null || parents.isEmpty()) {
            return;
        }

        for (String parentKey : parents.keySet()) {
            String parentIdValue = parents.get(parentKey);
            if (String.isBlank(parentIdValue)) {
                continue;
            }

            try {
                String parentObjectName = parentKey.endsWith('Id')
                    ? parentKey.substring(0, parentKey.length() - 2)
                    : parentKey;
                if (!DocgenObjectConfigService.isObjectSupported(parentObjectName)) {
                    continue;
                }

                Supported_Object__mdt parentConfig = DocgenObjectConfigService.getConfigForObject(parentObjectName);
                putConfiguredParentLookup(doc, parentConfig, (Id) parentIdValue);
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'Could not set composite parent lookup: ' + e.getMessage());
            }
        }
    }

    private static Id determineCompositePrimaryRecordId(Id compositeDocumentId, Map<String, Id> recordIds) {
        if (compositeDocumentId == null || recordIds == null || recordIds.isEmpty()) {
            return null;
        }

        Composite_Document__c composite = DocgenCompositeConfigReader.loadComposite(compositeDocumentId);
        if (composite == null) {
            return null;
        }

        String primaryParent = composite.PrimaryParent__c;
        if (String.isBlank(primaryParent)) {
            return recordIds.values()[0];
        }

        String normalizedParent = primaryParent.toLowerCase();
        Set<String> expectedKeys = new Set<String>{ normalizedParent + 'id' };

        if (normalizedParent.endsWith('__c')) {
            normalizedParent = normalizedParent.substring(0, normalizedParent.length() - 3);
        }

        Integer namespaceSeparator = normalizedParent.lastIndexOf('__');
        if (namespaceSeparator >= 0) {
            normalizedParent = normalizedParent.substring(namespaceSeparator + 2);
        }
        expectedKeys.add(normalizedParent + 'id');

        for (String key : recordIds.keySet()) {
            if (expectedKeys.contains(key.toLowerCase())) {
                return recordIds.get(key);
            }
        }

        return recordIds.values()[0];
    }

    private static void setConfiguredParentLookup(Generated_Document__c doc, Id parentId) {
        if (parentId == null) {
            return;
        }

        String objectApiName = parentId.getSObjectType().getDescribe().getName();
        DocgenObjectConfigService.validateObjectSupported(objectApiName);
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject(objectApiName);
        putConfiguredParentLookup(doc, config, parentId);
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
        result.contentVersionId = status.contentVersionId;
        result.contentDocumentId = status.contentDocumentId;
        result.previewUrl = status.previewUrl;
        result.canInlinePreview = status.canInlinePreview;
        result.isPreviewPending = status.isPreviewPending;
        result.attachmentWarnings = status.attachmentWarnings;
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
        result.isPreviewPending = doc.PendingPreview__c;
        result.attachmentWarnings = doc.Attachment_Warnings__c;
        result.canInlinePreview = doc.OutputFormat__c == 'PDF';

        if (
            doc.Status__c == 'SUCCEEDED' &&
            !doc.PendingPreview__c &&
            String.isNotBlank(doc.OutputFileId__c)
        ) {
            result.contentVersionId = doc.OutputFileId__c;
            result.contentDocumentId = getContentDocumentId(doc.OutputFileId__c);
            result.downloadUrl = buildDownloadUrl(doc.OutputFileId__c);
            result.previewUrl = buildPreviewUrl(result.contentDocumentId);
        }

        return result;
    }

    private static void validatePdfPreviewRequest(Id generatedDocumentId, Integer pageNumber) {
        if (generatedDocumentId == null) {
            throw new IllegalArgumentException('Generated Document ID is required');
        }
        if (generatedDocumentId.getSObjectType() != Generated_Document__c.SObjectType) {
            throw new IllegalArgumentException('A valid Generated Document ID is required');
        }
        if (pageNumber == null || pageNumber < 1) {
            throw new IllegalArgumentException('Preview page number must be a positive integer.');
        }
        if (pageNumber > MAX_PDF_PREVIEW_PAGES) {
            throw new IllegalArgumentException('PDF preview is limited to the first 20 pages.');
        }
    }

    private static String buildPreviewRequestHash(String requestHash, String correlationId) {
        Blob digest = Crypto.generateDigest('SHA-256', Blob.valueOf(requestHash + '|' + correlationId));
        return 'sha256:' + EncodingUtil.convertToHex(digest).toLowerCase();
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

    private static String getContentDocumentId(String contentVersionId) {
        if (String.isBlank(contentVersionId)) {
            return null;
        }

        if (Test.isRunningTest()) {
            String mockDocId = contentVersionId;
            if (mockDocId.startsWith('068')) {
                mockDocId = '069' + mockDocId.substring(3);
            }
            return mockDocId;
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

        return versions[0].ContentDocumentId;
    }

    private static String buildDownloadUrl(String contentVersionId) {
        if (String.isBlank(contentVersionId)) {
            return null;
        }
        return '/sfc/servlet.shepherd/version/download/' + contentVersionId;
    }

    private static String buildPreviewUrl(String contentDocumentId) {
        if (String.isBlank(contentDocumentId)) {
            return null;
        }
        return '/lightning/r/ContentDocument/' + contentDocumentId + '/view';
    }

    private static String buildFileName(String title, String extension) {
        if (String.isBlank(extension)) {
            return title;
        }
        if (String.isBlank(title) || title.toLowerCase().endsWith('.' + extension.toLowerCase())) {
            return title;
        }
        return title + '.' + extension;
    }

    private static void deleteGeneratedFiles(Generated_Document__c doc) {
        Set<Id> contentVersionIds = new Set<Id>();
        addContentVersionId(contentVersionIds, doc.OutputFileId__c);
        addContentVersionId(contentVersionIds, doc.MergedDocxFileId__c);
        if (String.isNotBlank(doc.Preview_Page_File_Ids__c)) {
            contentVersionIds.addAll(
                DocgenPreviewFileStore.parsePreviewContentVersionIdSet(doc.Preview_Page_File_Ids__c)
            );
        }

        DocgenPreviewFileStore.deleteContentVersions(contentVersionIds);
    }

    private static void deletePreviewFiles(Generated_Document__c doc) {
        if (String.isBlank(doc.Preview_Page_File_Ids__c)) {
            return;
        }
        DocgenPreviewFileStore.deleteContentVersions(
            DocgenPreviewFileStore.parsePreviewContentVersionIdSet(doc.Preview_Page_File_Ids__c)
        );
    }

    private static void addContentVersionId(Set<Id> contentVersionIds, String contentVersionId) {
        if (String.isBlank(contentVersionId)) {
            return;
        }
        try {
            contentVersionIds.add((Id) contentVersionId);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'Invalid ContentVersion ID: ' + contentVersionId);
        }
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
