/**
 * Trigger for Generated_Document__c object.
 * Handles creation of ContentDocumentLink records when document generation
 * is successful and files need to be linked to parent records.
 */
trigger GeneratedDocumentTrigger on Generated_Document__c (after update) {
    if (Trigger.isAfter && Trigger.isUpdate) {
        GeneratedDocumentTriggerHandler.handleAfterUpdate(Trigger.new, Trigger.oldMap);
    }
}