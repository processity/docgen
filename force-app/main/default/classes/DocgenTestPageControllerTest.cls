/**
 * Test class for DocgenTestPageController
 * Tests multi-object support for Account, Contact, Lead, Opportunity, and Case
 */
@isTest
private class DocgenTestPageControllerTest {

    @testSetup
    static void setup() {
        // Create test account
        Account testAccount = new Account(
            Name = 'Test Account',
            Type = 'Customer',
            Industry = 'Technology'
        );
        insert testAccount;

        // Create test contact
        Contact testContact = new Contact(
            FirstName = 'Test',
            LastName = 'Contact',
            Email = 'test@example.com',
            AccountId = testAccount.Id
        );
        insert testContact;

        // Create test opportunity
        Opportunity testOpp = new Opportunity(
            Name = 'Test Opportunity',
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30),
            AccountId = testAccount.Id
        );
        insert testOpp;

        // Create test case
        Case testCase = new Case(
            Subject = 'Test Case',
            Status = 'New',
            AccountId = testAccount.Id
        );
        insert testCase;

        // Create test lead
        Lead testLead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Status = 'Open - Not Contacted'
        );
        insert testLead;

        // Create test template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '068000000000000AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );
        insert template;

        // Create generated documents for each object
        List<Generated_Document__c> docs = new List<Generated_Document__c>();

        // Account documents
        for (Integer i = 0; i < 3; i++) {
            docs.add(new Generated_Document__c(
                Account__c = testAccount.Id,
                Template__c = template.Id,
                Status__c = 'SUCCEEDED',
                OutputFormat__c = 'PDF',
                RequestHash__c = 'account-hash-' + i,
                CorrelationId__c = 'account-corr-' + i
            ));
        }

        // Contact documents
        for (Integer i = 0; i < 2; i++) {
            docs.add(new Generated_Document__c(
                Contact__c = testContact.Id,
                Template__c = template.Id,
                Status__c = 'SUCCEEDED',
                OutputFormat__c = 'PDF',
                RequestHash__c = 'contact-hash-' + i,
                CorrelationId__c = 'contact-corr-' + i
            ));
        }

        // Lead documents
        docs.add(new Generated_Document__c(
            Lead__c = testLead.Id,
            Template__c = template.Id,
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            RequestHash__c = 'lead-hash-1',
            CorrelationId__c = 'lead-corr-1'
        ));

        // Opportunity documents
        docs.add(new Generated_Document__c(
            Opportunity__c = testOpp.Id,
            Template__c = template.Id,
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            RequestHash__c = 'opp-hash-1',
            CorrelationId__c = 'opp-corr-1'
        ));

        // Case documents
        docs.add(new Generated_Document__c(
            Case__c = testCase.Id,
            Template__c = template.Id,
            Status__c = 'SUCCEEDED',
            OutputFormat__c = 'PDF',
            RequestHash__c = 'case-hash-1',
            CorrelationId__c = 'case-corr-1'
        ));

        insert docs;
    }

    @isTest
    static void testGetSupportedObjects() {
        // Test
        Test.startTest();
        List<Supported_Object__mdt> result = DocgenTestPageController.getSupportedObjects();
        Test.stopTest();

        // Verify - should return active configured objects
        System.assertNotEquals(null, result, 'Should return list of supported objects');
        System.assert(result.size() > 0, 'Should have at least one supported object');

        // Verify objects are ordered by Display_Order__c
        if (result.size() > 1) {
            System.assert(
                result[0].Display_Order__c <= result[1].Display_Order__c,
                'Objects should be ordered by Display_Order__c'
            );
        }
    }

    @isTest
    static void testGetObjectTypeFromRecordId_Account() {
        Account testAccount = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        String objectType = DocgenTestPageController.getObjectTypeFromRecordId(testAccount.Id);
        Test.stopTest();

        System.assertEquals('Account', objectType, 'Should return Account for account record ID');
    }

    @isTest
    static void testGetObjectTypeFromRecordId_Contact() {
        Contact testContact = [SELECT Id FROM Contact LIMIT 1];

        Test.startTest();
        String objectType = DocgenTestPageController.getObjectTypeFromRecordId(testContact.Id);
        Test.stopTest();

        System.assertEquals('Contact', objectType, 'Should return Contact for contact record ID');
    }

    @isTest
    static void testGetObjectTypeFromRecordId_Lead() {
        Lead testLead = [SELECT Id FROM Lead LIMIT 1];

        Test.startTest();
        String objectType = DocgenTestPageController.getObjectTypeFromRecordId(testLead.Id);
        Test.stopTest();

        System.assertEquals('Lead', objectType, 'Should return Lead for lead record ID');
    }

    @isTest
    static void testGetObjectTypeFromRecordId_Opportunity() {
        Opportunity testOpp = [SELECT Id FROM Opportunity LIMIT 1];

        Test.startTest();
        String objectType = DocgenTestPageController.getObjectTypeFromRecordId(testOpp.Id);
        Test.stopTest();

        System.assertEquals('Opportunity', objectType, 'Should return Opportunity for opportunity record ID');
    }

    @isTest
    static void testGetObjectTypeFromRecordId_Case() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        String objectType = DocgenTestPageController.getObjectTypeFromRecordId(testCase.Id);
        Test.stopTest();

        System.assertEquals('Case', objectType, 'Should return Case for case record ID');
    }

    @isTest
    static void testGetObjectTypeFromRecordId_Null() {
        Test.startTest();
        String objectType = DocgenTestPageController.getObjectTypeFromRecordId(null);
        Test.stopTest();

        System.assertEquals(null, objectType, 'Should return null for null record ID');
    }

    @isTest
    static void testGetGeneratedDocuments_Account() {
        Account testAccount = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            testAccount.Id,
            'Account__c'
        );
        Test.stopTest();

        System.assertEquals(3, result.size(), 'Should return 3 generated documents for Account');
        System.assertNotEquals(null, result[0].Template__r, 'Should include template lookup');
        System.assertEquals('Test Template', result[0].Template__r.Name, 'Should include template name');
    }

    @isTest
    static void testGetGeneratedDocuments_Contact() {
        Contact testContact = [SELECT Id FROM Contact LIMIT 1];

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            testContact.Id,
            'Contact__c'
        );
        Test.stopTest();

        System.assertEquals(2, result.size(), 'Should return 2 generated documents for Contact');
    }

    @isTest
    static void testGetGeneratedDocuments_Lead() {
        Lead testLead = [SELECT Id FROM Lead LIMIT 1];

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            testLead.Id,
            'Lead__c'
        );
        Test.stopTest();

        System.assertEquals(1, result.size(), 'Should return 1 generated document for Lead');
    }

    @isTest
    static void testGetGeneratedDocuments_Opportunity() {
        Opportunity testOpp = [SELECT Id FROM Opportunity LIMIT 1];

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            testOpp.Id,
            'Opportunity__c'
        );
        Test.stopTest();

        System.assertEquals(1, result.size(), 'Should return 1 generated document for Opportunity');
    }

    @isTest
    static void testGetGeneratedDocuments_Case() {
        Case testCase = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            testCase.Id,
            'Case__c'
        );
        Test.stopTest();

        System.assertEquals(1, result.size(), 'Should return 1 generated document for Case');
    }

    @isTest
    static void testGetGeneratedDocuments_NullRecordId() {
        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            null,
            'Account__c'
        );
        Test.stopTest();

        System.assertEquals(0, result.size(), 'Should return empty list for null record ID');
    }

    @isTest
    static void testGetGeneratedDocuments_NullLookupField() {
        Account testAccount = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            testAccount.Id,
            null
        );
        Test.stopTest();

        System.assertEquals(0, result.size(), 'Should return empty list for null lookup field');
    }

    @isTest
    static void testGetGeneratedDocuments_InvalidLookupField() {
        Account testAccount = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        try {
            DocgenTestPageController.getGeneratedDocuments(testAccount.Id, 'InvalidField__c');
            System.assert(false, 'Should throw exception for invalid lookup field');
        } catch (Exception e) {
            // Exception thrown as expected - test passes
            // (Cacheable methods may wrap the exception differently)
            System.assertNotEquals(null, e, 'Should throw exception for invalid lookup field');
        }
        Test.stopTest();
    }

    @isTest
    static void testGetGeneratedDocuments_OrderingAndLimit() {
        Account testAccount = [SELECT Id FROM Account LIMIT 1];
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        // Create more documents to test limit
        List<Generated_Document__c> moreDocs = new List<Generated_Document__c>();
        for (Integer i = 10; i < 60; i++) {
            moreDocs.add(new Generated_Document__c(
                Account__c = testAccount.Id,
                Template__c = template.Id,
                Status__c = 'QUEUED',
                OutputFormat__c = 'PDF',
                RequestHash__c = 'test-hash-' + i,
                CorrelationId__c = 'test-corr-' + i
            ));
        }
        insert moreDocs;

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            testAccount.Id,
            'Account__c'
        );
        Test.stopTest();

        System.assertEquals(50, result.size(), 'Should respect LIMIT 50');
        // Verify ordering (newest first)
        System.assert(
            result[0].CreatedDate >= result[result.size()-1].CreatedDate,
            'Results should be ordered by CreatedDate DESC'
        );
    }

    @isTest
    static void testGetGeneratedDocuments_NonExistentRecord() {
        // Create a fake account ID that doesn't exist
        Id fakeAccountId = '001000000000000AAA';

        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(
            fakeAccountId,
            'Account__c'
        );
        Test.stopTest();

        System.assertEquals(0, result.size(), 'Should return empty list for non-existent record');
    }
}
