/**
 * Helper class to create ContentDocumentLink records for Generated Documents.
 * This class is called from the GeneratedDocumentTrigger when a document
 * generation is successful and files need to be linked to parent records.
 *
 * The class dynamically handles linking to ANY Salesforce object type
 * based on the parents field in the RequestJSON__c.
 */
public with sharing class ContentDocumentLinkHelper {

    /**
     * Creates ContentDocumentLink records for successfully generated documents.
     * Parses the RequestJSON__c field to extract parent IDs and creates links
     * to all specified parent records.
     *
     * @param generatedDocs List of Generated_Document__c records to process
     */
    public static void createLinksFromGeneratedDocuments(List<Generated_Document__c> generatedDocs) {
        // Collect all ContentVersion IDs to query ContentDocumentIds
        Set<Id> contentVersionIds = new Set<Id>();

        for (Generated_Document__c doc : generatedDocs) {
            if (String.isNotBlank(doc.OutputFileId__c)) {
                try {
                    // Validate it's a valid ID before adding to set
                    Id validId = (Id) doc.OutputFileId__c;
                    contentVersionIds.add(validId);
                } catch (Exception e) {
                    System.debug(LoggingLevel.WARN, 'Invalid OutputFileId for Generated_Document__c ' + doc.Id +
                               ': ' + doc.OutputFileId__c + ' - ' + e.getMessage());
                }
            }
            if (String.isNotBlank(doc.MergedDocxFileId__c)) {
                try {
                    // Validate it's a valid ID before adding to set
                    Id validId = (Id) doc.MergedDocxFileId__c;
                    contentVersionIds.add(validId);
                } catch (Exception e) {
                    System.debug(LoggingLevel.WARN, 'Invalid MergedDocxFileId for Generated_Document__c ' + doc.Id +
                               ': ' + doc.MergedDocxFileId__c + ' - ' + e.getMessage());
                }
            }
        }

        if (contentVersionIds.isEmpty()) {
            return; // No files to link
        }

        // Query ContentDocumentIds from ContentVersions
        Map<Id, Id> contentVersionToDocumentMap = getContentDocumentIds(contentVersionIds);

        // Prepare ContentDocumentLinks to insert
        List<ContentDocumentLink> linksToInsert = new List<ContentDocumentLink>();

        // Process each Generated Document
        for (Generated_Document__c doc : generatedDocs) {
            if (String.isBlank(doc.RequestJSON__c)) {
                continue; // No request data to process
            }

            try {
                // Parse the RequestJSON to extract parents
                Map<String, Object> envelope = (Map<String, Object>) JSON.deserializeUntyped(doc.RequestJSON__c);
                Map<String, Object> parents = (Map<String, Object>) envelope.get('parents');

                if (parents == null || parents.isEmpty()) {
                    continue; // No parents to link
                }

                // Create links for PDF output
                if (String.isNotBlank(doc.OutputFileId__c)) {
                    Id contentDocumentId = contentVersionToDocumentMap.get(doc.OutputFileId__c);
                    if (contentDocumentId != null) {
                        linksToInsert.addAll(createLinksForParents(contentDocumentId, parents));
                    }
                }

                // Create links for DOCX output if present
                if (String.isNotBlank(doc.MergedDocxFileId__c)) {
                    Id contentDocumentId = contentVersionToDocumentMap.get(doc.MergedDocxFileId__c);
                    if (contentDocumentId != null) {
                        linksToInsert.addAll(createLinksForParents(contentDocumentId, parents));
                    }
                }

            } catch (Exception e) {
                // Log error but don't fail the trigger
                System.debug(LoggingLevel.ERROR, 'Error processing Generated_Document__c Id: ' + doc.Id +
                           ' Error: ' + e.getMessage() + ' Stack: ' + e.getStackTraceString());
            }
        }

        // Insert ContentDocumentLinks with error handling
        if (!linksToInsert.isEmpty()) {
            insertContentDocumentLinks(linksToInsert);
        }
    }

    /**
     * Queries ContentDocumentIds for given ContentVersion IDs.
     *
     * @param contentVersionIds Set of ContentVersion IDs
     * @return Map of ContentVersion ID to ContentDocument ID
     */
    private static Map<Id, Id> getContentDocumentIds(Set<Id> contentVersionIds) {
        Map<Id, Id> versionToDocumentMap = new Map<Id, Id>();

        try {
            List<ContentVersion> versions = [
                SELECT Id, ContentDocumentId
                FROM ContentVersion
                WHERE Id IN :contentVersionIds
            ];

            for (ContentVersion cv : versions) {
                versionToDocumentMap.put(cv.Id, cv.ContentDocumentId);
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Error querying ContentVersions: ' + e.getMessage());
        }

        return versionToDocumentMap;
    }

    /**
     * Creates ContentDocumentLink records for all non-null parent IDs.
     *
     * @param contentDocumentId The ContentDocument ID to link
     * @param parents Map of parent object references (e.g., "AccountId" -> "001xxx")
     * @return List of ContentDocumentLink records to insert
     */
    private static List<ContentDocumentLink> createLinksForParents(Id contentDocumentId, Map<String, Object> parents) {
        List<ContentDocumentLink> links = new List<ContentDocumentLink>();

        // Iterate through all parent entries dynamically
        for (String key : parents.keySet()) {
            String parentId = (String) parents.get(key);

            // Only process non-null, non-empty parent IDs
            if (String.isNotBlank(parentId)) {
                // Validate it's a valid Salesforce ID
                try {
                    // Attempt to cast to ID - will throw exception if invalid format
                    Id validatedId = (Id) parentId;

                    ContentDocumentLink cdl = new ContentDocumentLink();
                    cdl.ContentDocumentId = contentDocumentId;
                    cdl.LinkedEntityId = validatedId;
                    cdl.ShareType = 'V'; // Viewer permission
                    cdl.Visibility = 'AllUsers';
                    links.add(cdl);
                } catch (Exception e) {
                    // Invalid ID format - log and skip
                    System.debug(LoggingLevel.WARN, 'Invalid parent ID format: ' + key + ' = ' + parentId +
                               ' Error: ' + e.getMessage());
                }
            }
        }

        return links;
    }

    /**
     * Inserts ContentDocumentLink records with error handling.
     * Failures are logged but don't fail the trigger.
     *
     * @param linksToInsert List of ContentDocumentLink records to insert
     */
    private static void insertContentDocumentLinks(List<ContentDocumentLink> linksToInsert) {
        try {
            // Use Database.insert for partial success handling
            List<Database.SaveResult> results = Database.insert(linksToInsert, false);

            // Log any errors
            for (Integer i = 0; i < results.size(); i++) {
                Database.SaveResult result = results[i];
                if (!result.isSuccess()) {
                    ContentDocumentLink failedLink = linksToInsert[i];
                    System.debug(LoggingLevel.ERROR, 'Failed to create ContentDocumentLink for ' +
                               'ContentDocumentId: ' + failedLink.ContentDocumentId +
                               ', LinkedEntityId: ' + failedLink.LinkedEntityId +
                               ', Errors: ' + result.getErrors());
                }
            }
        } catch (Exception e) {
            // Log error but don't fail the trigger
            System.debug(LoggingLevel.ERROR, 'Error inserting ContentDocumentLinks: ' +
                       e.getMessage() + ' Stack: ' + e.getStackTraceString());
        }
    }
}