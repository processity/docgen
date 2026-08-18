/**
 * Controller for DocgenTemplateFileManager LWC
 * Manages template DOCX/PPTX/XLSX files and version history for both Docgen_Template__c and Composite_Document__c
 */
public with sharing class DocgenTemplateFileController {

    private static final String DEFERRED_TEMPLATE_SOURCE = 'TBD';
    private static final Set<String> SUPPORTED_TEMPLATE_EXTENSIONS = new Set<String>{
        'docx', 'pptx', 'xlsx'
    };
    private static final Set<String> TEMPLATE_CREATE_FIELDS = new Set<String>{
        'Name',
        'DataSource__c',
        'Default_Output_Format__c',
        'SOQL__c',
        'ClassName__c',
        'ReturnMultipleRecords__c',
        'PrimaryParent__c',
        'Output_File_Name_Field__c',
        'Watermark_Text__c',
        'Watermark_Condition_Field__c',
        'Watermark_Style__c',
        'StoreMergedDocx__c'
    };
    private static final Set<String> COMPOSITE_CREATE_FIELDS = new Set<String>{
        'Description__c',
        'Template_Strategy__c',
        'Default_Output_Format__c',
        'PrimaryParent__c',
        'Output_File_Name_Field__c',
        'Watermark_Text__c',
        'Watermark_Condition_Field__c',
        'Watermark_Style__c',
        'StoreMergedDocx__c'
    };

    public class PrimaryParentOption {
        @AuraEnabled public String label;
        @AuraEnabled public String value;
        @AuraEnabled public Decimal displayOrder;

        private PrimaryParentOption(
            String label,
            String value,
            Decimal displayOrder
        ) {
            this.label = label;
            this.value = value;
            this.displayOrder = displayOrder;
        }
    }

    public class UploadedTemplateInfo {
        @AuraEnabled public Id contentDocumentId;
        @AuraEnabled public String title;
        @AuraEnabled public String fileExtension;
        @AuraEnabled public Integer contentSize;

        private UploadedTemplateInfo(ContentVersion version) {
            contentDocumentId = version.ContentDocumentId;
            title = version.Title;
            fileExtension = version.FileExtension;
            contentSize = version.ContentSize;
        }
    }

    /**
     * Get record metadata including object type and relevant fields
     * Works with both Docgen_Template__c and Composite_Document__c
     *
     * @param recordId The record Id (can be either object type)
     * @return Map containing objectType, templateStrategy (for Composite), and other metadata
     */
    @AuraEnabled
    public static Map<String, Object> getRecordMetadata(Id recordId) {
        try {
            Map<String, Object> metadata = new Map<String, Object>();
            String objectType = String.valueOf(recordId.getSObjectType());
            metadata.put('objectType', objectType);

            if (objectType == 'Composite_Document__c') {
                List<Composite_Document__c> docs = [
                    SELECT Id, Name, Template_Strategy__c, TemplateContentVersionId__c
                    FROM Composite_Document__c
                    WHERE Id = :recordId
                    LIMIT 1
                ];

                if (!docs.isEmpty()) {
                    metadata.put('templateStrategy', docs[0].Template_Strategy__c);
                    metadata.put('templateContentVersionId', docs[0].TemplateContentVersionId__c);
                    metadata.put('recordName', docs[0].Name);
                }
            } else if (objectType == 'Docgen_Template__c') {
                List<Docgen_Template__c> templates = [
                    SELECT Id, Name, TemplateContentVersionId__c
                    FROM Docgen_Template__c
                    WHERE Id = :recordId
                    LIMIT 1
                ];

                if (!templates.isEmpty()) {
                    metadata.put('templateContentVersionId', templates[0].TemplateContentVersionId__c);
                    metadata.put('recordName', templates[0].Name);
                }
            }

            return metadata;

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve record metadata: ' + e.getMessage());
        }
    }

    /**
     * Get all DOCX/PPTX/XLSX files linked to a record
     * Returns ContentVersion records with file metadata
     * Works with both Docgen_Template__c and Composite_Document__c
     *
     * @param recordId Record Id (can be either object type)
     * @return List of ContentVersion records (DOCX/PPTX/XLSX only)
     */
    @AuraEnabled
    public static List<ContentVersion> getTemplateFiles(Id recordId) {
        try {
            // Get all ContentDocumentLinks for this record
            List<ContentDocumentLink> links = [
                SELECT ContentDocumentId
                FROM ContentDocumentLink
                WHERE LinkedEntityId = :recordId
            ];

            if (links.isEmpty()) {
                return new List<ContentVersion>();
            }

            // Extract ContentDocument IDs
            Set<Id> documentIds = new Set<Id>();
            for (ContentDocumentLink link : links) {
                documentIds.add(link.ContentDocumentId);
            }

            // Get all versions of these documents (DOCX/PPTX/XLSX only)
            // Return all versions, not just latest, so user can see history
            List<ContentVersion> versions = [
                SELECT Id, Title, FileExtension, VersionNumber,
                       ContentDocumentId, LastModifiedDate, LastModifiedBy.Name,
                       ContentSize, IsLatest
                FROM ContentVersion
                WHERE ContentDocumentId IN :documentIds
                AND FileExtension IN ('docx', 'pptx', 'xlsx')
                ORDER BY LastModifiedDate DESC, Id DESC
            ];

            return versions;

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve template files: ' + e.getMessage());
        }
    }

    /**
     * Resolve and validate a privately staged upload before the new-record form is saved.
     */
    @AuraEnabled
    public static UploadedTemplateInfo getUploadedTemplateInfo(Id contentDocumentId) {
        try {
            return new UploadedTemplateInfo(getLatestTemplateVersion(contentDocumentId));
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Failed to inspect uploaded template: ' + e.getMessage());
        }
    }

    /**
     * Return active Docgen-supported objects for the Primary Parent selector.
     */
    @AuraEnabled(cacheable=true)
    public static List<PrimaryParentOption> getPrimaryParentOptions() {
        Map<String, Schema.SObjectType> objectTypes = Schema.getGlobalDescribe();
        List<PrimaryParentOption> options = new List<PrimaryParentOption>();

        for (Supported_Object__mdt config : DocgenObjectConfigService.getAllActiveConfigs().values()) {
            String objectApiName = config.Object_API_Name__c;
            if (String.isBlank(objectApiName)) {
                continue;
            }

            Schema.SObjectType objectType = objectTypes.get(objectApiName);
            if (objectType == null) {
                continue;
            }

            options.add(new PrimaryParentOption(
                objectType.getDescribe().getLabel() + ' — ' + objectApiName,
                objectApiName,
                config.Display_Order__c
            ));
        }
        return options;
    }

    /**
     * Create a template or composite configuration and link its staged template file in one transaction.
     * TemplateContentVersionId__c is derived from the upload or set to TBD until a file is added later.
     */
    @AuraEnabled
    public static Id createConfiguration(
        String objectApiName,
        Map<String, Object> fieldValues,
        Id contentDocumentId
    ) {
        try {
            Schema.SObjectType configurationType;
            Set<String> allowedFields;

            if (objectApiName == 'Docgen_Template__c') {
                configurationType = Docgen_Template__c.SObjectType;
                allowedFields = TEMPLATE_CREATE_FIELDS;
            } else if (objectApiName == 'Composite_Document__c') {
                configurationType = Composite_Document__c.SObjectType;
                allowedFields = COMPOSITE_CREATE_FIELDS;
            } else {
                throw new AuraHandledException('Unsupported configuration type: ' + objectApiName);
            }

            if (!configurationType.getDescribe().isCreateable()) {
                throw new AuraHandledException('You do not have permission to create ' +
                    configurationType.getDescribe().getLabel() + ' records.');
            }

            SObject configuration = configurationType.newSObject(null, false);
            copyAllowedFields(configuration, fieldValues, allowedFields);

            SObjectAccessDecision accessDecision = Security.stripInaccessible(
                AccessType.CREATABLE,
                new List<SObject>{ configuration }
            );
            Set<String> removedFields = accessDecision.getRemovedFields().get(objectApiName);
            if (removedFields != null && !removedFields.isEmpty()) {
                List<String> sortedRemovedFields = new List<String>(removedFields);
                sortedRemovedFields.sort();
                throw new AuraHandledException(
                    'You do not have permission to set: ' + String.join(sortedRemovedFields, ', ')
                );
            }

            configuration = accessDecision.getRecords()[0];
            ContentVersion templateVersion = validateConfiguration(
                objectApiName,
                configuration,
                contentDocumentId
            );

            // Protected values are derived server-side and never accepted from the caller.
            if (templateVersion != null) {
                configuration.put('TemplateContentVersionId__c', templateVersion.Id);
            } else if (
                objectApiName == 'Docgen_Template__c' ||
                stringValue(configuration.get('Template_Strategy__c')) == 'Own Template'
            ) {
                configuration.put('TemplateContentVersionId__c', DEFERRED_TEMPLATE_SOURCE);
            }
            configuration.put(
                'ReturnDocxToBrowser__c',
                objectApiName == 'Docgen_Template__c'
            );
            if (objectApiName == 'Composite_Document__c') {
                configuration.put('IsActive__c', true);
            }

            insert configuration;

            if (templateVersion != null) {
                insert new ContentDocumentLink(
                    LinkedEntityId = configuration.Id,
                    ContentDocumentId = templateVersion.ContentDocumentId,
                    ShareType = 'V',
                    Visibility = 'AllUsers'
                );
            }

            return configuration.Id;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Failed to create configuration: ' + e.getMessage());
        }
    }

    /**
     * Update the TemplateContentVersionId__c field on the record
     * Works with both Docgen_Template__c and Composite_Document__c
     *
     * @param recordId The record Id to update
     * @param contentVersionId The ContentVersion Id to set
     */
    @AuraEnabled
    public static void updateTemplateContentVersionId(Id recordId, Id contentVersionId) {
        try {
            String objectType = String.valueOf(recordId.getSObjectType());

            if (objectType == 'Composite_Document__c') {
                Composite_Document__c doc = new Composite_Document__c(
                    Id = recordId,
                    TemplateContentVersionId__c = contentVersionId
                );
                update doc;
            } else if (objectType == 'Docgen_Template__c') {
                Docgen_Template__c template = new Docgen_Template__c(
                    Id = recordId,
                    TemplateContentVersionId__c = contentVersionId
                );
                update template;
            } else {
                throw new AuraHandledException('Unsupported object type: ' + objectType);
            }

        } catch (AuraHandledException e) {
            // Re-throw AuraHandledException as-is to preserve the original message
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Failed to update template reference: ' + e.getMessage());
        }
    }

    private static void copyAllowedFields(
        SObject configuration,
        Map<String, Object> fieldValues,
        Set<String> allowedFields
    ) {
        if (fieldValues == null) {
            return;
        }

        for (String fieldName : fieldValues.keySet()) {
            if (!allowedFields.contains(fieldName)) {
                throw new AuraHandledException('Field cannot be set from this form: ' + fieldName);
            }

            Object fieldValue = fieldValues.get(fieldName);
            if (fieldValue != null) {
                configuration.put(fieldName, fieldValue);
            }
        }
    }

    private static ContentVersion validateConfiguration(
        String objectApiName,
        SObject configuration,
        Id contentDocumentId
    ) {
        validatePrimaryParent(configuration);

        if (objectApiName == 'Docgen_Template__c') {
            if (String.isBlank(stringValue(configuration.get('Name')))) {
                throw new AuraHandledException('Enter a template name.');
            }

            String dataSource = stringValue(configuration.get('DataSource__c'));
            if (dataSource == 'SOQL' && String.isBlank(stringValue(configuration.get('SOQL__c')))) {
                throw new AuraHandledException('Enter a SOQL query for the SOQL data source.');
            }
            if (dataSource == 'Custom' && String.isBlank(stringValue(configuration.get('ClassName__c')))) {
                throw new AuraHandledException('Enter an Apex provider class for the Custom data source.');
            }
            if (dataSource != 'SOQL' && dataSource != 'Custom') {
                throw new AuraHandledException('Select a supported data source.');
            }

            return contentDocumentId == null ? null : getLatestTemplateVersion(contentDocumentId);
        }

        String strategy = stringValue(configuration.get('Template_Strategy__c'));
        if (strategy == 'Own Template') {
            return contentDocumentId == null ? null : getLatestTemplateVersion(contentDocumentId);
        }
        if (strategy == 'Concatenate Templates') {
            if (contentDocumentId != null) {
                throw new AuraHandledException(
                    'Do not upload a master file for the Concatenate Templates strategy.'
                );
            }
            return null;
        }

        throw new AuraHandledException('Select a supported template strategy.');
    }

    private static void validatePrimaryParent(SObject configuration) {
        String primaryParent = stringValue(configuration.get('PrimaryParent__c'));
        if (
            String.isNotBlank(primaryParent) &&
            !DocgenObjectConfigService.isObjectSupported(primaryParent)
        ) {
            throw new AuraHandledException(
                'Select an active object configured in Docgen Supported Objects.'
            );
        }
    }

    private static ContentVersion getLatestTemplateVersion(Id contentDocumentId) {
        if (contentDocumentId == null) {
            throw new AuraHandledException('Upload a template file before saving.');
        }

        List<ContentVersion> versions = [
            SELECT Id, ContentDocumentId, Title, FileExtension, ContentSize
            FROM ContentVersion
            WHERE ContentDocumentId = :contentDocumentId
            AND IsLatest = true
            LIMIT 1
        ];
        if (versions.isEmpty()) {
            throw new AuraHandledException('The uploaded template file is not accessible.');
        }

        ContentVersion version = versions[0];
        String extension = version.FileExtension == null
            ? null
            : version.FileExtension.toLowerCase();
        if (!SUPPORTED_TEMPLATE_EXTENSIONS.contains(extension)) {
            throw new AuraHandledException('Only DOCX, PPTX, and XLSX template files are supported.');
        }
        return version;
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
