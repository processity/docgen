/**
 * Apex controller for Composite Document management
 * Provides methods for adding templates to composite documents via LWC
 *
 * @group Composite Documents
 * @see addTemplateToComposite LWC component
 */
public with sharing class CompositeDocumentController {

    /**
     * Get all active Docgen Templates for selection
     * Used by addTemplateToComposite LWC component
     *
     * @return List of active Docgen_Template__c records
     */
    @AuraEnabled(cacheable=true)
    public static List<Docgen_Template__c> getActiveTemplates() {
        try {
            return [
                SELECT Id, Name, PrimaryParent__c, DataSource__c,
                       TemplateContentVersionId__c, SOQL__c
                FROM Docgen_Template__c
                ORDER BY Name ASC
                LIMIT 200
            ];
        } catch (Exception e) {
            throw new AuraHandledException('Error retrieving templates: ' + e.getMessage());
        }
    }

    /**
     * Add a Docgen Template to a Composite Document
     * Creates a junction record (Composite_Document_Template__c) with validation
     *
     * @param compositeDocId ID of the Composite_Document__c record
     * @param templateId ID of the Docgen_Template__c record
     * @param namespace Unique namespace for this template's data
     * @param sequence Order in which template is processed (lower first)
     * @param isActive Whether the junction record is active
     * @return ID of the created junction record
     * @throws AuraHandledException if validation fails or DML error occurs
     */
    @AuraEnabled
    public static String addTemplateToComposite(
        Id compositeDocId,
        Id templateId,
        String namespace,
        Integer sequence,
        Boolean isActive
    ) {
        // Validate inputs
        if (compositeDocId == null) {
            throw new AuraHandledException('Composite Document ID is required');
        }

        if (templateId == null) {
            throw new AuraHandledException('Template ID is required');
        }

        if (String.isBlank(namespace)) {
            throw new AuraHandledException('Namespace is required');
        }

        if (sequence == null || sequence < 1) {
            throw new AuraHandledException('Sequence must be 1 or greater');
        }

        // Validate namespace pattern (alphanumeric + underscore, starts with letter)
        Pattern namespacePattern = Pattern.compile('^[A-Za-z][A-Za-z0-9_]*$');
        if (!namespacePattern.matcher(namespace).matches()) {
            throw new AuraHandledException(
                'Namespace must start with a letter and contain only letters, numbers, and underscores'
            );
        }

        // Check for duplicate namespace in the same composite document
        List<Composite_Document_Template__c> existingJunctions = [
            SELECT Id, Namespace__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :compositeDocId
              AND Namespace__c = :namespace
            LIMIT 1
        ];

        if (!existingJunctions.isEmpty()) {
            throw new AuraHandledException(
                'A template with namespace "' + namespace + '" already exists in this composite document. ' +
                'Please use a different namespace.'
            );
        }

        try {
            // Create junction record
            Composite_Document_Template__c junction = new Composite_Document_Template__c(
                Composite_Document__c = compositeDocId,
                Document_Template__c = templateId,
                Namespace__c = namespace,
                Sequence__c = sequence,
                IsActive__c = isActive
            );

            insert junction;

            return junction.Id;

        } catch (DmlException e) {
            // Extract meaningful error message
            String errorMessage = e.getDmlMessage(0);

            // Check for specific error types
            if (errorMessage.contains('DUPLICATE_VALUE')) {
                throw new AuraHandledException(
                    'A template with this namespace already exists. Please use a different namespace.'
                );
            } else if (errorMessage.contains('ENTITY_IS_DELETED')) {
                throw new AuraHandledException(
                    'The selected composite document or template has been deleted.'
                );
            } else if (errorMessage.contains('FIELD_CUSTOM_VALIDATION_EXCEPTION')) {
                throw new AuraHandledException('Validation error: ' + errorMessage);
            }

            throw new AuraHandledException('Error creating junction record: ' + errorMessage);
        } catch (Exception e) {
            throw new AuraHandledException('Unexpected error: ' + e.getMessage());
        }
    }

    /**
     * Get existing templates for a composite document (for edit/manage UI)
     *
     * @param compositeDocId ID of the Composite_Document__c record
     * @return List of junction records with template details
     */
    @AuraEnabled(cacheable=true)
    public static List<Composite_Document_Template__c> getCompositeTemplates(Id compositeDocId) {
        try {
            return [
                SELECT Id, Name, Namespace__c, Sequence__c, IsActive__c,
                       Document_Template__c, Document_Template__r.Name,
                       Document_Template__r.PrimaryParent__c,
                       Document_Template__r.DataSource__c
                FROM Composite_Document_Template__c
                WHERE Composite_Document__c = :compositeDocId
                ORDER BY Sequence__c ASC, Namespace__c ASC
            ];
        } catch (Exception e) {
            throw new AuraHandledException('Error retrieving composite templates: ' + e.getMessage());
        }
    }

    /**
     * Remove a template from a composite document
     *
     * @param junctionId ID of the Composite_Document_Template__c record to delete
     */
    @AuraEnabled
    public static void removeTemplateFromComposite(Id junctionId) {
        if (junctionId == null) {
            throw new AuraHandledException('Junction record ID is required');
        }

        try {
            delete [SELECT Id FROM Composite_Document_Template__c WHERE Id = :junctionId LIMIT 1];
        } catch (DmlException e) {
            throw new AuraHandledException('Error removing template: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException('Unexpected error: ' + e.getMessage());
        }
    }

    /**
     * Update junction record fields (namespace, sequence, isActive)
     *
     * @param junctionId ID of the junction record
     * @param namespace New namespace value
     * @param sequence New sequence value
     * @param isActive New active status
     */
    @AuraEnabled
    public static void updateJunctionRecord(
        Id junctionId,
        String namespace,
        Integer sequence,
        Boolean isActive
    ) {
        if (junctionId == null) {
            throw new AuraHandledException('Junction record ID is required');
        }

        try {
            Composite_Document_Template__c junction = [
                SELECT Id, Namespace__c, Sequence__c, IsActive__c
                FROM Composite_Document_Template__c
                WHERE Id = :junctionId
                LIMIT 1
            ];

            if (String.isNotBlank(namespace)) {
                junction.Namespace__c = namespace;
            }
            if (sequence != null) {
                junction.Sequence__c = sequence;
            }
            if (isActive != null) {
                junction.IsActive__c = isActive;
            }

            update junction;

        } catch (QueryException e) {
            throw new AuraHandledException('Junction record not found');
        } catch (DmlException e) {
            throw new AuraHandledException('Error updating junction record: ' + e.getDmlMessage(0));
        } catch (Exception e) {
            throw new AuraHandledException('Unexpected error: ' + e.getMessage());
        }
    }
}
