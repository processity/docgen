/**
 * Supplies the package-owned Generated Document record experience.
 * Subscriber-created source lookups are discovered at runtime so the package
 * does not need a compile-time dependency on objects such as SBQQ__Quote__c.
 */
public with sharing class GeneratedDocumentRecordController {
    private static final List<Schema.SObjectField> SUMMARY_FIELDS = new List<Schema.SObjectField>{
        Generated_Document__c.Status__c,
        Generated_Document__c.OutputFormat__c,
        Generated_Document__c.Template__c,
        Generated_Document__c.Composite_Document__c,
        Generated_Document__c.RequestedBy__c,
        Generated_Document__c.Attempts__c,
        Generated_Document__c.Priority__c,
        Generated_Document__c.RequestHash__c,
        Generated_Document__c.CorrelationId__c,
        Generated_Document__c.LockedUntil__c,
        Generated_Document__c.ScheduledRetryTime__c,
        Generated_Document__c.PendingPreview__c,
        Generated_Document__c.Created_Date__c,
        Generated_Document__c.Last_Modified_Date__c
    };

    private static final List<Schema.SObjectField> REQUEST_FIELDS = new List<Schema.SObjectField>{
        Generated_Document__c.RequestJSON__c,
        Generated_Document__c.RequestJSON02__c,
        Generated_Document__c.RequestJSON03__c,
        Generated_Document__c.RequestJSON04__c,
        Generated_Document__c.RequestJSON05__c,
        Generated_Document__c.RequestJSON06__c,
        Generated_Document__c.RequestJSON07__c,
        Generated_Document__c.RequestJSON08__c,
        Generated_Document__c.RequestJSON09__c,
        Generated_Document__c.RequestJSON10__c
    };

    public class RecordView {
        @AuraEnabled public List<String> summaryFieldApiNames = new List<String>();
        @AuraEnabled public List<LookupFieldInfo> lookupFields = new List<LookupFieldInfo>();
        @AuraEnabled public List<FileInfo> files = new List<FileInfo>();
        @AuraEnabled public List<PayloadInfo> payloads = new List<PayloadInfo>();
    }

    public class LookupFieldInfo {
        @AuraEnabled public String fieldApiName;
        @AuraEnabled public String label;

        public LookupFieldInfo(String fieldApiName, String label) {
            this.fieldApiName = fieldApiName;
            this.label = label;
        }
    }

    public class FileInfo {
        @AuraEnabled public Id contentVersionId;
        @AuraEnabled public Id contentDocumentId;
        @AuraEnabled public String displayName;
        @AuraEnabled public String fileExtension;
        @AuraEnabled public Integer contentSize;
        @AuraEnabled public Datetime createdDate;
        @AuraEnabled public String role;

        public FileInfo(ContentVersion version, String role) {
            contentVersionId = version.Id;
            contentDocumentId = version.ContentDocumentId;
            fileExtension = version.FileExtension;
            contentSize = version.ContentSize;
            createdDate = version.CreatedDate;
            this.role = role;

            String extension = String.isBlank(version.FileExtension)
                ? null
                : '.' + version.FileExtension.toLowerCase();
            displayName = extension == null || version.Title.toLowerCase().endsWith(extension)
                ? version.Title
                : version.Title + extension;
        }
    }

    public class PayloadInfo {
        @AuraEnabled public String key;
        @AuraEnabled public String label;
        @AuraEnabled public String value;
        @AuraEnabled public Integer characterCount;

        public PayloadInfo(String key, String label, String rawValue) {
            this.key = key;
            this.label = label;
            value = prettyPrintJson(rawValue);
            characterCount = rawValue.length();
        }
    }

    private class FileReference {
        private Id contentVersionId;
        private String role;

        private FileReference(Id contentVersionId, String role) {
            this.contentVersionId = contentVersionId;
            this.role = role;
        }
    }

    @AuraEnabled(cacheable=true)
    public static RecordView getRecordView(Id recordId) {
        if (recordId == null || recordId.getSObjectType() != Generated_Document__c.SObjectType) {
            throw new AuraHandledException('A valid Generated Document record ID is required.');
        }

        Schema.DescribeSObjectResult objectDescribe = Generated_Document__c.SObjectType.getDescribe();
        if (!objectDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to Generated Documents.');
        }

        Map<String, Schema.SObjectField> fieldMap = objectDescribe.fields.getMap();
        Set<String> queryFieldNames = new Set<String>{ 'Id' };
        List<String> accessibleSummaryFields = addAccessibleFields(queryFieldNames, SUMMARY_FIELDS);
        List<String> accessibleRequestFields = addAccessibleFields(queryFieldNames, REQUEST_FIELDS);

        String outputFileField = addAccessibleField(queryFieldNames, Generated_Document__c.OutputFileId__c);
        String mergedDocxField = addAccessibleField(queryFieldNames, Generated_Document__c.MergedDocxFileId__c);

        Set<String> excludedLookupNames = fieldNames(new List<Schema.SObjectField>{
            Generated_Document__c.Template__c,
            Generated_Document__c.Composite_Document__c,
            Generated_Document__c.RequestedBy__c
        });
        Set<String> requestFieldNames = fieldNames(REQUEST_FIELDS);
        String previewPageIdsField = Generated_Document__c.Preview_Page_File_Ids__c.getDescribe().getName();

        List<String> lookupFieldNames = new List<String>();
        Map<String, String> lookupLabels = new Map<String, String>();
        List<String> payloadFieldNames = new List<String>();
        Map<String, String> payloadLabels = new Map<String, String>();

        for (Schema.SObjectField fieldToken : fieldMap.values()) {
            Schema.DescribeFieldResult fieldDescribe = fieldToken.getDescribe();
            if (!fieldDescribe.isAccessible()) {
                continue;
            }

            String fieldName = fieldDescribe.getName();
            if (fieldDescribe.isCustom() &&
                fieldDescribe.getType() == Schema.DisplayType.Reference &&
                !excludedLookupNames.contains(fieldName)) {
                queryFieldNames.add(fieldName);
                lookupFieldNames.add(fieldName);
                lookupLabels.put(fieldName, fieldDescribe.getLabel());
            }

            if (fieldDescribe.getType() == Schema.DisplayType.TextArea &&
                !requestFieldNames.contains(fieldName) &&
                fieldName != previewPageIdsField) {
                queryFieldNames.add(fieldName);
                payloadFieldNames.add(fieldName);
                payloadLabels.put(fieldName, fieldDescribe.getLabel());
            }
        }

        List<String> orderedQueryFields = new List<String>(queryFieldNames);
        orderedQueryFields.sort();
        String query = 'SELECT ' + String.join(orderedQueryFields, ',') +
            ' FROM ' + objectDescribe.getName() +
            ' WHERE Id = :recordId LIMIT 1';

        List<SObject> records = Database.queryWithBinds(
            query,
            new Map<String, Object>{ 'recordId' => recordId },
            AccessLevel.USER_MODE
        );
        if (records.isEmpty()) {
            throw new AuraHandledException('Generated Document not found or inaccessible.');
        }

        Generated_Document__c document = (Generated_Document__c) records[0];
        RecordView view = new RecordView();

        for (String fieldName : accessibleSummaryFields) {
            if (document.get(fieldName) != null) {
                view.summaryFieldApiNames.add(fieldName);
            }
        }

        lookupFieldNames.sort();
        for (String fieldName : lookupFieldNames) {
            if (document.get(fieldName) != null) {
                view.lookupFields.add(new LookupFieldInfo(fieldName, lookupLabels.get(fieldName)));
            }
        }

        view.files = loadFiles(document, outputFileField, mergedDocxField);

        String requestJson = reconstructRequestJson(document, accessibleRequestFields);
        if (String.isNotBlank(requestJson)) {
            view.payloads.add(new PayloadInfo('request-json', 'Request JSON', requestJson));
        }
        view.payloads.add(new PayloadInfo(
            'response',
            'Response',
            buildResponseJson(document, queryFieldNames, outputFileField, mergedDocxField)
        ));

        payloadFieldNames.sort();
        for (String fieldName : payloadFieldNames) {
            String payloadValue = (String) document.get(fieldName);
            if (String.isNotBlank(payloadValue)) {
                view.payloads.add(new PayloadInfo(fieldName, payloadLabels.get(fieldName), payloadValue));
            }
        }

        return view;
    }

    private static List<FileInfo> loadFiles(
        Generated_Document__c document,
        String outputFileField,
        String mergedDocxField
    ) {
        List<FileReference> references = new List<FileReference>();
        addFileReference(references, document, outputFileField, 'Generated output');
        addFileReference(references, document, mergedDocxField, 'Merged DOCX');
        if (references.isEmpty()) {
            return new List<FileInfo>();
        }

        Set<Id> versionIds = new Set<Id>();
        for (FileReference reference : references) {
            versionIds.add(reference.contentVersionId);
        }

        Map<Id, ContentVersion> versionsById = new Map<Id, ContentVersion>([
            SELECT Id, ContentDocumentId, Title, FileExtension, ContentSize, CreatedDate
            FROM ContentVersion
            WHERE Id IN :versionIds
            WITH USER_MODE
        ]);

        List<FileInfo> files = new List<FileInfo>();
        for (FileReference reference : references) {
            ContentVersion version = versionsById.get(reference.contentVersionId);
            if (version != null) {
                files.add(new FileInfo(version, reference.role));
            }
        }
        return files;
    }

    private static void addFileReference(
        List<FileReference> references,
        Generated_Document__c document,
        String fieldName,
        String role
    ) {
        if (String.isBlank(fieldName)) {
            return;
        }

        String value = (String) document.get(fieldName);
        if (String.isBlank(value)) {
            return;
        }

        try {
            Id fileId = (Id) value;
            if (fileId.getSObjectType() == ContentVersion.SObjectType) {
                references.add(new FileReference(fileId, role));
            }
        } catch (Exception ignored) {
            // Historical records can contain stale file IDs; omit inaccessible tiles.
        }
    }

    private static List<String> addAccessibleFields(
        Set<String> queryFieldNames,
        List<Schema.SObjectField> fieldTokens
    ) {
        List<String> names = new List<String>();
        for (Schema.SObjectField fieldToken : fieldTokens) {
            String fieldName = addAccessibleField(queryFieldNames, fieldToken);
            if (fieldName != null) {
                names.add(fieldName);
            }
        }
        return names;
    }

    private static String addAccessibleField(
        Set<String> queryFieldNames,
        Schema.SObjectField fieldToken
    ) {
        Schema.DescribeFieldResult fieldDescribe = fieldToken.getDescribe();
        if (!fieldDescribe.isAccessible()) {
            return null;
        }
        String fieldName = fieldDescribe.getName();
        queryFieldNames.add(fieldName);
        return fieldName;
    }

    private static Set<String> fieldNames(List<Schema.SObjectField> fieldTokens) {
        Set<String> names = new Set<String>();
        for (Schema.SObjectField fieldToken : fieldTokens) {
            names.add(fieldToken.getDescribe().getName());
        }
        return names;
    }

    private static String reconstructRequestJson(
        Generated_Document__c document,
        List<String> accessibleRequestFields
    ) {
        List<String> segments = new List<String>();
        for (String fieldName : accessibleRequestFields) {
            String segment = (String) document.get(fieldName);
            if (segment != null) {
                segments.add(segment);
            }
        }
        return segments.isEmpty() ? null : String.join(segments, '');
    }

    private static String buildResponseJson(
        Generated_Document__c document,
        Set<String> queriedFieldNames,
        String outputFileField,
        String mergedDocxField
    ) {
        Map<String, Object> response = new Map<String, Object>{
            'generatedDocumentId' => document.Id
        };
        Map<String, String> responseFields = new Map<String, String>{
            'status' => Generated_Document__c.Status__c.getDescribe().getName(),
            'outputFormat' => Generated_Document__c.OutputFormat__c.getDescribe().getName(),
            'correlationId' => Generated_Document__c.CorrelationId__c.getDescribe().getName(),
            'attempts' => Generated_Document__c.Attempts__c.getDescribe().getName(),
            'outputContentVersionId' => outputFileField,
            'mergedDocxContentVersionId' => mergedDocxField
        };
        for (String responseKey : responseFields.keySet()) {
            String fieldName = responseFields.get(responseKey);
            if (String.isNotBlank(fieldName) && queriedFieldNames.contains(fieldName)) {
                response.put(responseKey, document.get(fieldName));
            }
        }
        return JSON.serialize(response);
    }

    private static String prettyPrintJson(String value) {
        String trimmed = value == null ? null : value.trim();
        if (String.isBlank(trimmed) ||
            (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
            return value;
        }

        try {
            return JSON.serializePretty(JSON.deserializeUntyped(value));
        } catch (Exception ignored) {
            return value;
        }
    }

}
