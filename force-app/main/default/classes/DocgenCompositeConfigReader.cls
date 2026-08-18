/**
 * Reads DocGen composite configuration in system context.
 *
 * Composite documents and junctions are administrator-managed configuration.
 * Runtime users can generate from that configuration without receiving direct
 * record access to the configuration objects.
 */
public without sharing class DocgenCompositeConfigReader {
    public static Id findActiveCompositeDocumentId(String objectApiName, String configuredName) {
        if (String.isBlank(objectApiName) || String.isBlank(configuredName)) {
            return null;
        }

        String normalizedName = configuredName.trim();
        List<Composite_Document__c> matches = [
            SELECT Id, Name, Description__c
            FROM Composite_Document__c
            WHERE PrimaryParent__c = :objectApiName
              AND IsActive__c = true
            WITH SYSTEM_MODE
            ORDER BY LastModifiedDate DESC
        ];

        Id nameMatch;
        for (Composite_Document__c composite : matches) {
            if (equalsIgnoreCase(composite.Description__c, normalizedName)) {
                return composite.Id;
            }
            if (nameMatch == null && equalsIgnoreCase(composite.Name, normalizedName)) {
                nameMatch = composite.Id;
            }
        }
        return nameMatch;
    }

    public static Composite_Document__c loadComposite(Id compositeDocumentId) {
        if (compositeDocumentId == null) {
            return null;
        }

        List<Composite_Document__c> composites = [
            SELECT Id, Name, Template_Strategy__c, TemplateContentVersionId__c,
                   StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                   Default_Output_Format__c, Output_File_Name_Field__c, Watermark_Text__c,
                   Watermark_Condition_Field__c, Watermark_Style__c
            FROM Composite_Document__c
            WHERE Id = :compositeDocumentId
            WITH SYSTEM_MODE
            LIMIT 1
        ];
        return composites.isEmpty() ? null : composites[0];
    }

    public static String getPrimaryParent(Id compositeDocumentId) {
        Composite_Document__c composite = loadComposite(compositeDocumentId);
        return composite == null ? null : composite.PrimaryParent__c;
    }

    public static String getDefaultOutputFormat(Id compositeDocumentId) {
        Composite_Document__c composite = loadComposite(compositeDocumentId);
        return composite == null ? null : composite.Default_Output_Format__c;
    }

    public static List<Composite_Document_Template__c> loadActiveJunctions(Id compositeDocumentId) {
        if (compositeDocumentId == null) {
            return new List<Composite_Document_Template__c>();
        }

        return [
            SELECT Id, Name, Namespace__c, Sequence__c, Document_Template__c,
                   Inclusion_Formula__c, Composite_Document__r.Template_Strategy__c,
                   Document_Template__r.Name,
                   Document_Template__r.TemplateContentVersionId__c,
                   Document_Template__r.DataSource__c,
                   Document_Template__r.SOQL__c,
                   Document_Template__r.ClassName__c,
                   Document_Template__r.ReturnMultipleRecords__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :compositeDocumentId
              AND IsActive__c = true
            WITH SYSTEM_MODE
            ORDER BY Sequence__c ASC
        ];
    }

    public static List<Composite_Document_Template__c> loadIncludedJunctions(
        Id compositeDocumentId,
        Set<Id> includedJunctionIds
    ) {
        if (compositeDocumentId == null || includedJunctionIds == null || includedJunctionIds.isEmpty()) {
            return new List<Composite_Document_Template__c>();
        }

        return [
            SELECT Id, Namespace__c, Sequence__c, Inclusion_Formula__c,
                   Document_Template__r.TemplateContentVersionId__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :compositeDocumentId
              AND IsActive__c = true
              AND Id IN :includedJunctionIds
            WITH SYSTEM_MODE
            ORDER BY Sequence__c ASC
        ];
    }

    private static Boolean equalsIgnoreCase(String leftValue, String rightValue) {
        return leftValue != null && rightValue != null && leftValue.trim().equalsIgnoreCase(rightValue.trim());
    }
}
