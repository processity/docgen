/**
 * Writes generated-document tracking records in system context.
 *
 * Templates and composite documents are administrator-managed configuration
 * with private external sharing. Runtime controllers validate user-visible
 * source records before crossing this narrow DML boundary.
 */
public without sharing class DocgenGeneratedDocumentWriter {
    public static void insertTrackingRecord(Generated_Document__c document) {
        Database.insert(document, AccessLevel.SYSTEM_MODE);
    }

    public static void updateTrackingRecord(Generated_Document__c document) {
        Database.update(document, AccessLevel.SYSTEM_MODE);
    }
}
