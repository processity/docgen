/**
 * Trigger handler for Generated_Document__c object.
 * Manages the creation of ContentDocumentLink records when document generation
 * is successful and ContentVersion files are available.
 */
public with sharing class GeneratedDocumentTriggerHandler {

    /**
     * Handles after update trigger events for Generated_Document__c records.
     * Creates ContentDocumentLink records when Status changes to SUCCEEDED
     * and OutputFileId is populated.
     *
     * @param newDocs The new versions of Generated_Document__c records
     * @param oldMap The old versions of Generated_Document__c records by Id
     */
    public static void handleAfterUpdate(List<Generated_Document__c> newDocs, Map<Id, Generated_Document__c> oldMap) {
        List<Generated_Document__c> docsToProcess = new List<Generated_Document__c>();

        // Filter for documents that just succeeded with files to link
        for (Generated_Document__c newDoc : newDocs) {
            Generated_Document__c oldDoc = oldMap.get(newDoc.Id);

            // Check if status changed to SUCCEEDED
            if (newDoc.Status__c == 'SUCCEEDED' && oldDoc.Status__c != 'SUCCEEDED') {
                // Check if there's at least one file to link
                if (String.isNotBlank(newDoc.OutputFileId__c) || String.isNotBlank(newDoc.MergedDocxFileId__c)) {
                    // Check if RequestJSON is populated (contains parent information)
                    if (String.isNotBlank(newDoc.RequestJSON__c)) {
                        docsToProcess.add(newDoc);
                    }
                }
            }
        }

        // Process documents to create ContentDocumentLinks
        if (!docsToProcess.isEmpty()) {
            ContentDocumentLinkHelper.createLinksFromGeneratedDocuments(docsToProcess);
        }
    }
}