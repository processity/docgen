/**
 * Test class for CompositeDocumentController
 * Validates junction record creation, validation, and error handling
 *
 * @group Composite Documents
 */
@isTest
private class CompositeDocumentControllerTest {

    @testSetup
    static void setup() {
        // Create test templates
        List<Docgen_Template__c> templates = new List<Docgen_Template__c>();

        templates.add(new Docgen_Template__c(
            Name = 'Account Summary Template',
            PrimaryParent__c = 'Account',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            TemplateContentVersionId__c = '068000000000001',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = false
        ));

        templates.add(new Docgen_Template__c(
            Name = 'Terms and Conditions',
            PrimaryParent__c = 'Account',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id FROM Account WHERE Id = :recordId',
            TemplateContentVersionId__c = '068000000000002',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = false
        ));

        insert templates;

        // Create composite document
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test Composite Document',
            Template_Strategy__c = 'Concatenate Templates',
            PrimaryParent__c = 'Account',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = false,
            IsActive__c = true
        );
        insert composite;
    }

    @isTest
    static void testGetActiveTemplates() {
        // Act
        Test.startTest();
        List<Docgen_Template__c> templates = CompositeDocumentController.getActiveTemplates();
        Test.stopTest();

        // Assert
        System.assertEquals(2, templates.size(), 'Should return all templates');
        System.assertEquals('Account Summary Template', templates[0].Name, 'Templates should be ordered by name');
    }

    @isTest
    static void testAddTemplateToComposite_Success() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c WHERE Name = 'Account Summary Template' LIMIT 1];

        // Act
        Test.startTest();
        String junctionId = CompositeDocumentController.addTemplateToComposite(
            composite.Id,
            template.Id,
            'Account',
            10,
            true
        );
        Test.stopTest();

        // Assert
        System.assertNotEquals(null, junctionId, 'Junction record ID should be returned');

        Composite_Document_Template__c junction = [
            SELECT Id, Namespace__c, Sequence__c, IsActive__c, Document_Template__c
            FROM Composite_Document_Template__c
            WHERE Id = :junctionId
        ];

        System.assertEquals('Account', junction.Namespace__c, 'Namespace should match');
        System.assertEquals(10, junction.Sequence__c, 'Sequence should match');
        System.assertEquals(true, junction.IsActive__c, 'IsActive should match');
        System.assertEquals(template.Id, junction.Document_Template__c, 'Template should match');
    }

    @isTest
    static void testAddTemplateToComposite_DuplicateNamespace() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        List<Docgen_Template__c> templates = [SELECT Id FROM Docgen_Template__c ORDER BY Name LIMIT 2];

        // Create first junction record
        CompositeDocumentController.addTemplateToComposite(
            composite.Id,
            templates[0].Id,
            'Account',
            10,
            true
        );

        // Act & Assert
        Test.startTest();
        Boolean exceptionThrown = false;
        try {
            CompositeDocumentController.addTemplateToComposite(
                composite.Id,
                templates[1].Id,
                'Account', // Duplicate namespace
                20,
                true
            );
        } catch (Exception e) {
            exceptionThrown = true;
        }
        Test.stopTest();
        System.assert(exceptionThrown, 'Should have thrown exception for duplicate namespace');
    }

    @isTest
    static void testAddTemplateToComposite_InvalidNamespace() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        // Test invalid namespace starting with number
        Test.startTest();
        Boolean exceptionThrown = false;
        try {
            CompositeDocumentController.addTemplateToComposite(
                composite.Id,
                template.Id,
                '123Invalid', // Starts with number
                10,
                true
            );
        } catch (Exception e) {
            exceptionThrown = true;
        }
        Test.stopTest();
        System.assert(exceptionThrown, 'Should have thrown exception for invalid namespace');
    }

    @isTest
    static void testAddTemplateToComposite_MissingRequiredFields() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        Test.startTest();

        // Test null composite ID
        Boolean exception1 = false;
        try {
            CompositeDocumentController.addTemplateToComposite(null, template.Id, 'Account', 10, true);
        } catch (Exception e) {
            exception1 = true;
        }
        System.assert(exception1, 'Should throw exception for null composite ID');

        // Test null template ID
        Boolean exception2 = false;
        try {
            CompositeDocumentController.addTemplateToComposite(composite.Id, null, 'Account', 10, true);
        } catch (Exception e) {
            exception2 = true;
        }
        System.assert(exception2, 'Should throw exception for null template ID');

        // Test blank namespace
        Boolean exception3 = false;
        try {
            CompositeDocumentController.addTemplateToComposite(composite.Id, template.Id, '', 10, true);
        } catch (Exception e) {
            exception3 = true;
        }
        System.assert(exception3, 'Should throw exception for blank namespace');

        // Test invalid sequence
        Boolean exception4 = false;
        try {
            CompositeDocumentController.addTemplateToComposite(composite.Id, template.Id, 'Account', 0, true);
        } catch (Exception e) {
            exception4 = true;
        }
        System.assert(exception4, 'Should throw exception for invalid sequence');

        Test.stopTest();
    }

    @isTest
    static void testGetCompositeTemplates() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        List<Docgen_Template__c> templates = [SELECT Id FROM Docgen_Template__c ORDER BY Name LIMIT 2];

        // Create junction records
        CompositeDocumentController.addTemplateToComposite(composite.Id, templates[0].Id, 'Account', 10, true);
        CompositeDocumentController.addTemplateToComposite(composite.Id, templates[1].Id, 'Terms', 20, true);

        // Act
        Test.startTest();
        List<Composite_Document_Template__c> junctions = CompositeDocumentController.getCompositeTemplates(composite.Id);
        Test.stopTest();

        // Assert
        System.assertEquals(2, junctions.size(), 'Should return 2 junction records');
        System.assertEquals('Account', junctions[0].Namespace__c, 'First record should be ordered by sequence');
        System.assertEquals(10, junctions[0].Sequence__c, 'Sequence should be 10');
        System.assertEquals('Terms', junctions[1].Namespace__c, 'Second record should be Terms');
        System.assertNotEquals(null, junctions[0].Document_Template__r.Name, 'Template name should be populated');
    }

    @isTest
    static void testRemoveTemplateFromComposite() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        String junctionId = CompositeDocumentController.addTemplateToComposite(
            composite.Id,
            template.Id,
            'Account',
            10,
            true
        );

        // Act
        Test.startTest();
        CompositeDocumentController.removeTemplateFromComposite(junctionId);
        Test.stopTest();

        // Assert
        List<Composite_Document_Template__c> junctions = [
            SELECT Id FROM Composite_Document_Template__c WHERE Id = :junctionId
        ];
        System.assertEquals(0, junctions.size(), 'Junction record should be deleted');
    }

    @isTest
    static void testRemoveTemplateFromComposite_NullId() {
        Test.startTest();
        Boolean exceptionThrown = false;
        try {
            CompositeDocumentController.removeTemplateFromComposite(null);
        } catch (Exception e) {
            exceptionThrown = true;
        }
        Test.stopTest();
        System.assert(exceptionThrown, 'Should throw exception for null ID');
    }

    @isTest
    static void testUpdateJunctionRecord() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        String junctionId = CompositeDocumentController.addTemplateToComposite(
            composite.Id,
            template.Id,
            'Account',
            10,
            true
        );

        // Act
        Test.startTest();
        CompositeDocumentController.updateJunctionRecord(junctionId, 'AccountUpdated', 20, false);
        Test.stopTest();

        // Assert
        Composite_Document_Template__c junction = [
            SELECT Id, Namespace__c, Sequence__c, IsActive__c
            FROM Composite_Document_Template__c
            WHERE Id = :junctionId
        ];

        System.assertEquals('AccountUpdated', junction.Namespace__c, 'Namespace should be updated');
        System.assertEquals(20, junction.Sequence__c, 'Sequence should be updated');
        System.assertEquals(false, junction.IsActive__c, 'IsActive should be updated');
    }

    @isTest
    static void testUpdateJunctionRecord_NullId() {
        Test.startTest();
        Boolean exceptionThrown = false;
        try {
            CompositeDocumentController.updateJunctionRecord(null, 'Test', 10, true);
        } catch (Exception e) {
            exceptionThrown = true;
        }
        Test.stopTest();
        System.assert(exceptionThrown, 'Should throw exception for null ID');
    }

    @isTest
    static void testAddMultipleTemplates() {
        // Arrange
        Composite_Document__c composite = [SELECT Id FROM Composite_Document__c LIMIT 1];
        List<Docgen_Template__c> templates = [SELECT Id FROM Docgen_Template__c ORDER BY Name];

        // Act
        Test.startTest();
        List<String> junctionIds = new List<String>();
        junctionIds.add(CompositeDocumentController.addTemplateToComposite(composite.Id, templates[0].Id, 'Account', 10, true));
        junctionIds.add(CompositeDocumentController.addTemplateToComposite(composite.Id, templates[1].Id, 'Terms', 20, true));
        Test.stopTest();

        // Assert
        System.assertEquals(2, junctionIds.size(), 'Should create 2 junction records');

        List<Composite_Document_Template__c> junctions = [
            SELECT Id, Namespace__c, Sequence__c
            FROM Composite_Document_Template__c
            WHERE Composite_Document__c = :composite.Id
            ORDER BY Sequence__c
        ];

        System.assertEquals(2, junctions.size(), 'Should have 2 junction records');
        System.assertEquals('Account', junctions[0].Namespace__c, 'First should be Account');
        System.assertEquals('Terms', junctions[1].Namespace__c, 'Second should be Terms');
    }
}
