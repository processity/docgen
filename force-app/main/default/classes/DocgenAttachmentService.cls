/**
 * Validates additional PDF ContentVersions under the calling user's access and
 * supplies related PDF files for generation components.
 */
public with sharing class DocgenAttachmentService {
    public static final Integer MAX_FILE_COUNT = 20;
    public static final Integer MAX_TOTAL_BYTES = 50 * 1024 * 1024;

    public class AttachmentWarning {
        @AuraEnabled public String contentVersionId;
        @AuraEnabled public String title;
        @AuraEnabled public String code;
        @AuraEnabled public String message;

        public AttachmentWarning(Id contentVersionId, String title, String code, String message) {
            this.contentVersionId = contentVersionId == null ? null : String.valueOf(contentVersionId);
            this.title = title;
            this.code = code;
            this.message = message;
        }
    }

    public class ValidationResult {
        public List<Id> contentVersionIds = new List<Id>();
        public List<AttachmentWarning> warnings = new List<AttachmentWarning>();
    }

    public class RelatedPdfFile {
        @AuraEnabled public Id contentVersionId;
        @AuraEnabled public String title;
        @AuraEnabled public Integer contentSize;
        @AuraEnabled public Datetime lastModifiedDate;

        public RelatedPdfFile(ContentVersion version) {
            contentVersionId = version.Id;
            title = version.Title;
            contentSize = version.ContentSize;
            lastModifiedDate = version.LastModifiedDate;
        }
    }

    public class AttachmentContext {
        @AuraEnabled public String effectiveOutputFormat;
        @AuraEnabled public List<RelatedPdfFile> files = new List<RelatedPdfFile>();
    }

    public static ValidationResult validateForGeneration(List<Id> requestedIds, String outputFormat) {
        ValidationResult result = new ValidationResult();
        if (outputFormat != 'PDF' || requestedIds == null || requestedIds.isEmpty()) {
            return result;
        }

        List<Id> orderedIds = deduplicate(requestedIds);
        if (orderedIds.size() > MAX_FILE_COUNT) {
            throw new IllegalArgumentException('A maximum of 20 additional PDF files is supported');
        }

        Map<Id, ContentVersion> visibleVersions = new Map<Id, ContentVersion>([
            SELECT Id, Title, FileExtension, FileType, ContentSize
            FROM ContentVersion
            WHERE Id IN :orderedIds
            WITH USER_MODE
        ]);

        Integer totalBytes = 0;
        for (Id requestedId : orderedIds) {
            ContentVersion version = visibleVersions.get(requestedId);
            if (version == null) {
                result.warnings.add(new AttachmentWarning(
                    requestedId,
                    null,
                    'CONTENT_VERSION_NOT_FOUND',
                    'Skipped missing or inaccessible ContentVersion: ' + requestedId
                ));
                continue;
            }

            Boolean isPdf = version.FileType == 'PDF' ||
                (version.FileExtension != null && version.FileExtension.toLowerCase() == 'pdf');
            if (!isPdf) {
                result.warnings.add(new AttachmentWarning(
                    version.Id,
                    version.Title,
                    'NOT_A_PDF',
                    'Skipped non-PDF file: ' + version.Title
                ));
                continue;
            }

            totalBytes += version.ContentSize == null ? 0 : version.ContentSize;
            if (totalBytes > MAX_TOTAL_BYTES) {
                throw new IllegalArgumentException(
                    'Additional PDF files exceed the 50 MiB aggregate size limit'
                );
            }
            result.contentVersionIds.add(version.Id);
        }

        return result;
    }

    public static List<Id> sortSet(Set<Id> requestedIds) {
        List<Id> sortedIds = requestedIds == null ? new List<Id>() : new List<Id>(requestedIds);
        sortedIds.sort();
        return sortedIds;
    }

    public static String serializeWarnings(List<AttachmentWarning> warnings) {
        return warnings == null || warnings.isEmpty() ? null : JSON.serialize(warnings);
    }

    @AuraEnabled(cacheable=true)
    public static List<RelatedPdfFile> getRelatedPdfFiles(Id recordId) {
        if (recordId == null) {
            return new List<RelatedPdfFile>();
        }

        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :recordId
            WITH USER_MODE
        ]) {
            documentIds.add(link.ContentDocumentId);
        }
        if (documentIds.isEmpty()) {
            return new List<RelatedPdfFile>();
        }

        List<RelatedPdfFile> files = new List<RelatedPdfFile>();
        for (ContentVersion version : [
            SELECT Id, Title, ContentSize, LastModifiedDate
            FROM ContentVersion
            WHERE ContentDocumentId IN :documentIds
              AND IsLatest = true
              AND FileType = 'PDF'
            WITH USER_MODE
            ORDER BY LastModifiedDate DESC
            LIMIT 200
        ]) {
            files.add(new RelatedPdfFile(version));
        }
        return files;
    }

    @AuraEnabled
    public static AttachmentContext getAttachmentContext(
        Id recordId,
        Id templateId,
        String templateName,
        Id compositeDocumentId,
        String requestedOutputFormat
    ) {
        AttachmentContext context = new AttachmentContext();
        String defaultOutputFormat;

        if (String.isBlank(requestedOutputFormat)) {
            if (compositeDocumentId != null) {
                defaultOutputFormat = DocgenCompositeConfigReader.getDefaultOutputFormat(compositeDocumentId);
            } else if (templateId != null || String.isNotBlank(templateName)) {
                List<Docgen_Template__c> templates;
                if (templateId != null) {
                    templates = [
                        SELECT Default_Output_Format__c
                        FROM Docgen_Template__c
                        WHERE Id = :templateId
                        WITH USER_MODE
                        LIMIT 1
                    ];
                } else {
                    templates = [
                        SELECT Default_Output_Format__c
                        FROM Docgen_Template__c
                        WHERE Name = :templateName
                        WITH USER_MODE
                        LIMIT 1
                    ];
                }
                defaultOutputFormat = templates.isEmpty()
                    ? null
                    : templates[0].Default_Output_Format__c;
            }
        }

        context.effectiveOutputFormat = DocgenEnvelopeService.resolveOutputFormat(
            requestedOutputFormat,
            defaultOutputFormat
        );
        if (context.effectiveOutputFormat == 'PDF') {
            context.files = getRelatedPdfFiles(recordId);
        }
        return context;
    }

    private static List<Id> deduplicate(List<Id> requestedIds) {
        Set<Id> seen = new Set<Id>();
        List<Id> orderedIds = new List<Id>();
        for (Id requestedId : requestedIds) {
            if (requestedId != null && !seen.contains(requestedId)) {
                seen.add(requestedId);
                orderedIds.add(requestedId);
            }
        }
        return orderedIds;
    }
}
