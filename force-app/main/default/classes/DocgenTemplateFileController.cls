/**
 * Controller for DocgenTemplateFileManager LWC
 * Manages template DOCX files and version history for both Docgen_Template__c and Composite_Document__c
 */
public with sharing class DocgenTemplateFileController {

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
     * Get all DOCX files linked to a record
     * Returns ContentVersion records with file metadata
     * Works with both Docgen_Template__c and Composite_Document__c
     *
     * @param recordId Record Id (can be either object type)
     * @return List of ContentVersion records (DOCX only)
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

            // Get all versions of these documents (DOCX only)
            // Return all versions, not just latest, so user can see history
            List<ContentVersion> versions = [
                SELECT Id, Title, FileExtension, VersionNumber,
                       ContentDocumentId, LastModifiedDate, LastModifiedBy.Name,
                       ContentSize, IsLatest
                FROM ContentVersion
                WHERE ContentDocumentId IN :documentIds
                AND FileExtension = 'docx'
                ORDER BY ContentDocumentId, VersionNumber DESC
            ];

            return versions;

        } catch (Exception e) {
            throw new AuraHandledException('Failed to retrieve template files: ' + e.getMessage());
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

        } catch (Exception e) {
            throw new AuraHandledException('Failed to update template reference: ' + e.getMessage());
        }
    }
}
