/**
 * Controller for DocgenTemplateFileManager LWC
 * Manages template DOCX files and version history
 */
public with sharing class DocgenTemplateFileController {

    /**
     * Get all DOCX files linked to a template
     * Returns ContentVersion records with file metadata
     *
     * @param templateId Docgen_Template__c record Id
     * @return List of ContentVersion records (DOCX only)
     */
    @AuraEnabled
    public static List<ContentVersion> getTemplateFiles(Id templateId) {
        try {
            // Get all ContentDocumentLinks for this template
            List<ContentDocumentLink> links = [
                SELECT ContentDocumentId
                FROM ContentDocumentLink
                WHERE LinkedEntityId = :templateId
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
}
