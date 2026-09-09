/**
 * Reads DocGen template configuration in system context.
 *
 * Docgen templates are administrator-managed configuration. Runtime users can
 * generate from that configuration without receiving direct record access to
 * the configuration objects, mirroring DocgenCompositeConfigReader.
 */
public without sharing class DocgenTemplateConfigReader {
    public static Docgen_Template__c loadTemplateById(Id templateId) {
        if (templateId == null) {
            return null;
        }

        List<Docgen_Template__c> templates = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                   ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                   ReturnMultipleRecords__c, Output_File_Name_Field__c, Locale_Field__c,
                   Watermark_Text__c, Watermark_Condition_Field__c, Watermark_Style__c,
                   Default_Output_Format__c
            FROM Docgen_Template__c
            WHERE Id = :templateId
            WITH SYSTEM_MODE
            LIMIT 1
        ];
        return templates.isEmpty() ? null : templates[0];
    }

    public static Docgen_Template__c loadTemplateByName(String templateName) {
        if (String.isBlank(templateName)) {
            return null;
        }

        String normalizedName = templateName.trim();
        List<Docgen_Template__c> templates = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                   ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                   ReturnMultipleRecords__c, Output_File_Name_Field__c, Locale_Field__c,
                   Watermark_Text__c, Watermark_Condition_Field__c, Watermark_Style__c,
                   Default_Output_Format__c
            FROM Docgen_Template__c
            WHERE Name = :normalizedName
            WITH SYSTEM_MODE
            LIMIT 1
        ];
        return templates.isEmpty() ? null : templates[0];
    }
}
