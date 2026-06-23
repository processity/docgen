/**
 * Test class for DocgenEnvelopeService
 * Validates envelope building and RequestHash computation
 */
@isTest
private class DocgenEnvelopeServiceTest {

    @isTest
    static void testComputeHashIsDeterministic() {
        // Given: Same inputs for hash computation
        String templateId = '068000000000001AAA';
        String outputFormat = 'PDF';
        String dataJson = '{"Account":{"Name":"Acme"}}';

        // When: Computing hash multiple times
        Test.startTest();
        String hash1 = DocgenEnvelopeService.computeHash(templateId, outputFormat, dataJson);
        String hash2 = DocgenEnvelopeService.computeHash(templateId, outputFormat, dataJson);
        Test.stopTest();

        // Then: Hashes should be identical
        Assert.areEqual(hash1, hash2, 'Hash should be deterministic');
        Assert.isTrue(hash1.startsWith('sha256:'), 'Hash should start with sha256: prefix');
        Assert.areEqual(71, hash1.length(), 'Hash should be 71 chars (sha256: + 64 hex chars)');
    }

    @isTest
    static void testComputeHashDifferentInputs() {
        // Given: Different inputs
        String templateId1 = '068000000000001AAA';
        String templateId2 = '068000000000002AAA';
        String outputFormat = 'PDF';
        String dataJson = '{"Account":{"Name":"Acme"}}';

        // When: Computing hashes with different template IDs
        Test.startTest();
        String hash1 = DocgenEnvelopeService.computeHash(templateId1, outputFormat, dataJson);
        String hash2 = DocgenEnvelopeService.computeHash(templateId2, outputFormat, dataJson);
        Test.stopTest();

        // Then: Hashes should be different
        Assert.areNotEqual(hash1, hash2, 'Different inputs should produce different hashes');
    }

    @isTest
    static void testComputeHashDifferentFormats() {
        // Given: Same template but different output formats
        String templateId = '068000000000001AAA';
        String dataJson = '{"Account":{"Name":"Acme"}}';

        // When: Computing hashes with PDF vs DOCX
        Test.startTest();
        String hashPDF = DocgenEnvelopeService.computeHash(templateId, 'PDF', dataJson);
        String hashDOCX = DocgenEnvelopeService.computeHash(templateId, 'DOCX', dataJson);
        Test.stopTest();

        // Then: Hashes should be different
        Assert.areNotEqual(hashPDF, hashDOCX, 'Different formats should produce different hashes');
    }

    @isTest
    static void testBuildEnvelopeWithAccount() {
        // Given: An Account and SOQL template
        Account acc = DocgenTestDataFactory.createAccount('Acme Ltd');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Account Template',
            'Account',
            'SOQL',
            'SELECT Id, Name, BillingCity, AnnualRevenue FROM Account WHERE Id = :recordId',
            null,
            '068000000000001AAA',
            true,
            false,
            false
        );

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Envelope should be complete
        Assert.areEqual('068000000000001AAA', env.templateId, 'Template ID should match');
        Assert.areEqual('PDF', env.outputFormat, 'Output format should be PDF');
        Assert.areEqual('en-GB', env.locale, 'Locale should match');
        Assert.areEqual('Europe/London', env.timezone, 'Timezone should match');
        Assert.isNotNull(env.options, 'Options should not be null');
        Assert.isTrue((Boolean) env.options.get('storeMergedDocx'), 'StoreMergedDocx should be true');
        Assert.isFalse((Boolean) env.options.get('returnDocxToBrowser'), 'ReturnDocxToBrowser should be false');
        Assert.isNotNull(env.data, 'Data should not be null');
        Assert.isNotNull(env.parents, 'Parents should not be null');
        Assert.areEqual(acc.Id, env.parents.get('AccountId'), 'AccountId should be set');
        Assert.isNotNull(env.requestHash, 'RequestHash should not be null');
        Assert.isTrue(env.requestHash.startsWith('sha256:'), 'RequestHash should have sha256 prefix');
    }

    @isTest
    static void testBuildEnvelopeIncludesWatermarkStyleWhenWatermarkApplies() {
        // Given: A template with watermark text and explicit style
        Account acc = DocgenTestDataFactory.createAccount('Watermark Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Watermark Template',
            'Account',
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000051AAA',
            false,
            false,
            false
        );
        template.Watermark_Text__c = 'DRAFT';
        template.Watermark_Style__c = 'Font: Courier\nWidth: 350\nHeight: 50\nRotation: -45\nColor code: #808080';
        update template;

        template = [
            SELECT Id, Name, TemplateContentVersionId__c, DataSource__c, SOQL__c,
                   ClassName__c, StoreMergedDocx__c, ReturnDocxToBrowser__c, PrimaryParent__c,
                   ReturnMultipleRecords__c, Output_File_Name_Field__c,
                   Watermark_Text__c, Watermark_Condition_Field__c, Watermark_Style__c,
                   Default_Output_Format__c
            FROM Docgen_Template__c
            WHERE Id = :template.Id
        ];

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Watermark style should be sent to the backend alongside the watermark text
        Assert.areEqual('DRAFT', env.options.get('watermarkText'), 'Watermark text should be included');
        Assert.areEqual(
            template.Watermark_Style__c,
            env.options.get('watermarkStyle'),
            'Watermark style should be included'
        );
    }

    @isTest
    static void testBuildEnvelopeWithOpportunity() {
        // Given: An Opportunity with Account
        Account acc = DocgenTestDataFactory.createAccount('Test Account');
        Opportunity opp = DocgenTestDataFactory.createOpportunity('Test Opportunity', acc.Id);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Opportunity Template',
            'Opportunity',
            'SOQL',
            'SELECT Id, Name, Amount, AccountId FROM Opportunity WHERE Id = :recordId',
            null,
            '068000000000002AAA',
            false,
            false,
            false
        );

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            opp.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Both Opportunity and Account IDs should be in parents
        Assert.isNotNull(env.parents, 'Parents should not be null');
        Assert.areEqual(opp.Id, env.parents.get('OpportunityId'), 'OpportunityId should be set');
        Assert.areEqual(acc.Id, env.parents.get('AccountId'), 'AccountId should be set from Opportunity');
    }

    @isTest
    static void testBuildEnvelopeWithCase() {
        // Given: A Case with Account
        Account acc = DocgenTestDataFactory.createAccount('Test Account');
        Case cs = DocgenTestDataFactory.createCase('Test Case', acc.Id);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Case Template',
            'Case',
            'SOQL',
            'SELECT Id, Subject, AccountId FROM Case WHERE Id = :recordId',
            null,
            '068000000000003AAA',
            false,
            false,
            false
        );

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            cs.Id,
            template,
            'PDF',
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: Case and Account IDs should be in parents
        Assert.isNotNull(env.parents, 'Parents should not be null');
        Assert.areEqual(cs.Id, env.parents.get('CaseId'), 'CaseId should be set');
        Assert.areEqual(acc.Id, env.parents.get('AccountId'), 'AccountId should be set from Case');
        Assert.areEqual(false, env.options.get('readOnlyWord'), 'readOnlyWord should default to false when Standard_Template__c is unavailable');
    }

    @isTest
    static void testToJSON() {
        // Given: An envelope
        DocgenEnvelopeService.Envelope env = new DocgenEnvelopeService.Envelope();
        env.templateId = '068000000000001AAA';
        env.outputFileName = 'Test.pdf';
        env.outputFormat = 'PDF';
        env.locale = 'en-GB';
        env.timezone = 'Europe/London';
        env.options = new Map<String, Object>{
            'storeMergedDocx' => false,
            'returnDocxToBrowser' => true
        };
        env.data = new Map<String, Object>{
            'Account' => new Map<String, Object>{
                'Name' => 'Acme'
            }
        };
        env.parents = new Map<String, String>{
            'AccountId' => '001000000000001AAA'
        };
        env.requestHash = 'sha256:abc123';

        // When: Converting to JSON
        Test.startTest();
        String jsonString = DocgenEnvelopeService.toJSON(env);
        Test.stopTest();

        // Then: Should be valid JSON with all fields
        Assert.isNotNull(jsonString, 'JSON should not be null');
        Assert.isTrue(jsonString.contains('templateId'), 'JSON should contain templateId');
        Assert.isTrue(jsonString.contains('068000000000001AAA'), 'JSON should contain template ID value');
        Assert.isTrue(jsonString.contains('requestHash'), 'JSON should contain requestHash');
        Assert.isTrue(jsonString.contains('sha256:abc123'), 'JSON should contain hash value');
        Assert.isTrue(jsonString.contains('Acme'), 'JSON should contain data values');

        // Verify it can be deserialized
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(jsonString);
        Assert.isNotNull(parsed, 'Parsed JSON should not be null');
        Assert.areEqual('PDF', parsed.get('outputFormat'), 'Deserialized format should match');
    }

    @isTest
    static void testBuildWithCustomProvider() {
        // Given: A template with Custom data source
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createCustomTemplate(
            'Custom Provider Template',
            null,
            'MockCustomProvider'
        );

        // When: Building envelope with custom provider
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Should use custom provider
        Assert.isNotNull(env, 'Envelope should not be null');
        Assert.isNotNull(env.data, 'Data should not be null');
        Assert.isNotNull(env.requestHash, 'RequestHash should be computed');
    }

    @isTest
    static void testBuildWithInvalidDataSource() {
        // Given: A template with invalid DataSource (manually set in test)
        Account acc = DocgenTestDataFactory.createAccount('Test');

        // Note: In real scenario, picklist prevents this, but testing defensive code
        Docgen_Template__c template = DocgenTestDataFactory.createTemplate(
            'Invalid Source',
            null,
            'SELECT Id FROM Account WHERE Id = :recordId'
        );

        // When: Trying to build with invalid provider setup
        Test.startTest();
        try {
            DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
                acc.Id,
                template,
                'PDF',
                'en-GB',
                'Europe/London'
            );
            // Should succeed with SOQL provider
            Assert.isNotNull(env, 'Envelope should be created');
        } catch (Exception e) {
            Assert.fail('Should not throw exception for valid SOQL provider');
        }
        Test.stopTest();
    }

    @isTest
    static void testOptionsMapping() {
        // Given: A template with specific options
        Account acc = DocgenTestDataFactory.createAccount('Test');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Options Test',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000006AAA',
            true,
            true,
            false
        );

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'DOCX',
            'en-US',
            'America/Los_Angeles'
        );
        Test.stopTest();

        // Then: Options should match template settings
        Assert.isTrue((Boolean) env.options.get('storeMergedDocx'), 'StoreMergedDocx should be true');
        Assert.isTrue((Boolean) env.options.get('returnDocxToBrowser'), 'ReturnDocxToBrowser should be true');
        Assert.areEqual('DOCX', env.outputFormat, 'Output format should be DOCX');
    }

    @isTest
    static void testBuildWithOpportunityWithoutAccount() {
        // Given: An Opportunity WITHOUT AccountId (orphan opportunity)
        Opportunity opp = DocgenTestDataFactory.createOpportunity('Orphan Opportunity', null);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Orphan Opp Template',
            'Opportunity',
            'SOQL',
            'SELECT Id, Name, Amount, AccountId FROM Opportunity WHERE Id = :recordId',
            null,
            '068000000000007AAA',
            false,
            false,
            false
        );

        // When: Building envelope for opportunity without account
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            opp.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Should not throw error, AccountId should be null
        Assert.isNotNull(env, 'Envelope should not be null');
        Assert.isNotNull(env.parents, 'Parents map should exist');
        Assert.areEqual(opp.Id, env.parents.get('OpportunityId'), 'OpportunityId should be set');

        // AccountId should be null (not throw exception)
        String accountId = env.parents.get('AccountId');
        Assert.isTrue(accountId == null || accountId == '',
            'AccountId should be null or empty for orphan opportunity');
    }

    @isTest
    static void testBuildWithCaseWithoutAccount() {
        // Given: A Case WITHOUT AccountId
        Case cs = DocgenTestDataFactory.createCase('Orphan Case', null);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Orphan Case Template',
            'Case',
            'SOQL',
            'SELECT Id, Subject, AccountId FROM Case WHERE Id = :recordId',
            null,
            '068000000000008AAA',
            false,
            false,
            false
        );

        // When: Building envelope for case without account
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            cs.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Should handle null AccountId gracefully
        Assert.isNotNull(env, 'Envelope should not be null');
        Assert.areEqual(cs.Id, env.parents.get('CaseId'), 'CaseId should be set');

        String accountId = env.parents.get('AccountId');
        Assert.isTrue(accountId == null || accountId == '',
            'AccountId should be null or empty for orphan case');
    }

    @isTest
    static void testOutputFileNameGeneration() {
        // Given: Account and template for filename generation
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Test Template with Special $%^ Chars',
            'Account',
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000009AAA',
            false,
            false,
            false
        );

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Output filename should be generated
        Assert.isNotNull(env.outputFileName, 'Output filename should not be null');
        Assert.isTrue(env.outputFileName.length() > 0, 'Output filename should not be empty');

        // Should contain template name or derivation
        Assert.isTrue(
            env.outputFileName.contains('Test') ||
            env.outputFileName.contains('Document') ||
            env.outputFileName.contains('.pdf'),
            'Filename should have meaningful content or extension'
        );
    }

    @isTest
    static void testOutputFileNameFromConfiguredField() {
        Account acc = DocgenTestDataFactory.createAccount('Acme Contract.docx');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Configured File Name Template',
            'Account',
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000019AAA',
            false,
            false,
            false
        );
        template.Output_File_Name_Field__c = 'Account.Name';
        update template;

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        Assert.areEqual('Acme Contract.pdf', env.outputFileName, 'Configured file name should enforce the requested extension');
    }

    @isTest
    static void testRequestJSONSegmentsRoundTrip() {
        String padding = '';
        for (Integer i = 0; i < 1400; i++) {
            padding += 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
        }
        String requestJSON = '{"parents":{"AccountId":"001000000000001AAA"},"padding":"' + padding + '"}';
        Generated_Document__c doc = new Generated_Document__c();

        Test.startTest();
        DocgenEnvelopeService.setRequestJSONSegments(doc, requestJSON);
        String reconstructed = DocgenEnvelopeService.reconstructRequestJSON(doc);
        Test.stopTest();

        Assert.areEqual(131072, doc.RequestJSON__c.length(), 'Segment 1 should use the original RequestJSON__c field limit');
        Assert.isNotNull(doc.RequestJSON02__c, 'Segment 2 should be populated for large request JSON');
        Assert.areEqual(requestJSON, reconstructed, 'Segment reconstruction should preserve the full request JSON');
    }

    @isTest
    static void testHashStabilityAcrossRebuilds() {
        // Given: Same account and template
        Account acc = DocgenTestDataFactory.createAccount('Stable Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Stable Template',
            'Account',
            'SOQL',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            null,
            '068000000000010AAA',
            false,
            false,
            false
        );

        // When: Building envelope twice with same inputs
        Test.startTest();
        DocgenEnvelopeService.Envelope env1 = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );

        DocgenEnvelopeService.Envelope env2 = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: RequestHash should be identical (deterministic)
        Assert.areEqual(env1.requestHash, env2.requestHash,
            'RequestHash should be identical for same inputs (idempotency key)');

        Assert.isNotNull(env1.requestHash, 'RequestHash should not be null');
        Assert.isTrue(env1.requestHash.startsWith('sha256:'), 'Hash should have sha256 prefix');
    }

    @isTest
    static void testHashChangesWhenDataChanges() {
        // Given: Account with different data values
        Account acc1 = DocgenTestDataFactory.createAccount('Account One');
        Account acc2 = DocgenTestDataFactory.createAccount('Account Two');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Same Template',
            'Account',
            'SOQL',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            null,
            '068000000000011AAA',
            false,
            false,
            false
        );

        // When: Building envelopes for different accounts
        Test.startTest();
        DocgenEnvelopeService.Envelope env1 = DocgenEnvelopeService.build(
            acc1.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );

        DocgenEnvelopeService.Envelope env2 = DocgenEnvelopeService.build(
            acc2.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: RequestHash should be different (data changed)
        Assert.areNotEqual(env1.requestHash, env2.requestHash,
            'RequestHash should differ when data changes');
    }

    @isTest
    static void testEnvelopeWithAllParentTypes() {
        // Given: Case related to both Account and Opportunity (if possible via custom config)
        // For standard Case, we can only link to Account directly
        // This test verifies the parents map handles all three types

        Account acc = DocgenTestDataFactory.createAccount('Multi-Parent Account');
        Opportunity opp = DocgenTestDataFactory.createOpportunity('Related Opportunity', acc.Id);
        Case cs = DocgenTestDataFactory.createCase('Multi-Parent Case', acc.Id);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Multi-Parent Template',
            'Case',
            'SOQL',
            'SELECT Id, Subject, AccountId FROM Case WHERE Id = :recordId',
            null,
            '068000000000012AAA',
            false,
            false,
            false
        );

        // When: Building envelope for Case
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            cs.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Parents map should be structured correctly
        Assert.isNotNull(env.parents, 'Parents map should exist');
        Assert.areEqual(cs.Id, env.parents.get('CaseId'), 'CaseId should be set');
        Assert.areEqual(acc.Id, env.parents.get('AccountId'), 'AccountId should be extracted from Case');

        // OpportunityId would be null in standard Case scenario
        String oppId = env.parents.get('OpportunityId');
        Assert.isTrue(oppId == null || oppId == '',
            'OpportunityId should be null for Case (no standard relationship)');
    }

    @isTest
    static void testBuildWithFailingCustomProvider() {
        // Given: Template with failing custom provider
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createCustomTemplate(
            'Failing Provider Template',
            null,
            'FailingCustomProvider'
        );

        // When/Then: Should throw exception from custom provider
        Test.startTest();
        try {
            DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
                acc.Id,
                template,
                'PDF',
                'en-GB',
                'Europe/London'
            );
            Assert.fail('Should have thrown exception from failing provider');
        } catch (Exception e) {
            Assert.isTrue(
                e.getMessage().contains('intentionally failed') ||
                e.getMessage().contains('Provider'),
                'Exception should mention provider failure'
            );
        }
        Test.stopTest();
    }

    @isTest
    static void testBuildWithNonExistentCustomProvider() {
        // Given: Template with non-existent provider class
        Account acc = DocgenTestDataFactory.createAccount('Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createCustomTemplate(
            'Non-Existent Provider Template',
            null,
            'NonExistentProvider'
        );

        // When/Then: Should throw exception for missing provider class
        Test.startTest();
        try {
            DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
                acc.Id,
                template,
                'PDF',
                'en-GB',
                'Europe/London'
            );
            Assert.fail('Should have thrown exception for non-existent provider');
        } catch (Exception e) {
            // TypeException or similar for missing class
            Assert.isNotNull(e.getMessage(), 'Exception message should exist');
        }
        Test.stopTest();
    }

    @isTest
    static void testVeryLargeDataEnvelope() {
        // Given: Account with many contacts (large data set)
        Account acc = DocgenTestDataFactory.createAccount('Large Data Account');

        // Create many contacts to generate large data set
        List<Contact> contacts = DocgenTestDataFactory.createContacts(200, acc.Id);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Large Data Template',
            'Account',
            'SOQL',
            'SELECT Id, Name, AnnualRevenue, (SELECT Id, FirstName, LastName, Email, Description FROM Contacts) FROM Account WHERE Id = :recordId',
            null,
            '068000000000015AAA',
            false,
            false,
            false
        );

        // When: Building envelope with large data set
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Should handle large data set without errors
        Assert.isNotNull(env, 'Envelope should not be null');
        Assert.isNotNull(env.data, 'Data should not be null');
        Assert.isNotNull(env.requestHash, 'RequestHash should be computed even for large data');

        // Verify data contains contacts
        Map<String, Object> accountData = (Map<String, Object>) env.data.get('Account');
        List<Object> contactsList = (List<Object>) accountData.get('Contacts');
        Assert.areEqual(200, contactsList.size(), 'Should contain all 200 contacts');

        // Check JSON serialization size
        String jsonString = DocgenEnvelopeService.toJSON(env);
        Assert.isNotNull(jsonString, 'JSON serialization should succeed');

        // Long Text Area limit is 131,072 characters
        // If envelope is very large, we should be aware of it
        Assert.isTrue(
            jsonString.length() > 0,
            'JSON should have content'
        );
    }

    @isTest
    static void testRequestJSONSize() {
        // Given: Account for envelope generation
        Account acc = DocgenTestDataFactory.createAccount('JSON Size Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'JSON Size Template',
            'Account',
            'SOQL',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            null,
            '068000000000016AAA',
            false,
            false,
            false
        );

        // When: Building envelope and serializing to JSON
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            acc.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        String jsonString = DocgenEnvelopeService.toJSON(env);
        Test.stopTest();

        // Then: JSON should fit in RequestJSON__c field (Long Text Area = 131,072 chars)
        Assert.isNotNull(jsonString, 'JSON should not be null');
        Assert.isTrue(jsonString.length() > 0, 'JSON should have content');

        // For typical use cases, JSON should be much smaller than limit
        // But we should be aware if it approaches the limit
        Integer jsonSize = jsonString.length();
        System.debug('RequestJSON size: ' + jsonSize + ' characters');

        // Warn if approaching limit (use 80% as threshold)
        Integer threshold = (Integer) (131072 * 0.8);
        if (jsonSize > threshold) {
            System.debug('WARNING: RequestJSON size approaching Long Text Area limit');
        }

        // For this simple case, should be well under limit
        Assert.isTrue(
            jsonSize < 131072,
            'RequestJSON should fit in Long Text Area field'
        );
    }

    // ========== T-06: Dynamic Parent Extraction Tests ==========

    @isTest
    static void testExtractParentIds_Contact_ReturnsSingleParent() {
        // Given: Contact record with no Account parent
        Contact contact = DocgenTestDataFactory.createContact('Test', 'Contact', null);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Contact Template',
            'Contact',
            'SOQL',
            'SELECT Id, FirstName, LastName, Email FROM Contact WHERE Id = :recordId',
            null,
            '068000000000017AAA',
            false,
            false,
            false
        );

        // When: Building envelope for Contact
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            contact.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Parents map should contain ContactId with dynamic key format
        Assert.isNotNull(env.parents, 'Parents map should exist');
        Assert.areEqual(contact.Id, env.parents.get('ContactId'), 'ContactId should be set with key "ContactId"');

        // Other parent IDs should not be present (or be null)
        Assert.isTrue(
            !env.parents.containsKey('AccountId') || env.parents.get('AccountId') == null,
            'AccountId should not be present for orphan Contact'
        );
    }

    @isTest
    static void testExtractParentIds_Lead_ReturnsSingleParent() {
        // Given: Lead record with no parent relationships
        Lead lead = DocgenTestDataFactory.createLead('Test', 'Lead', 'Test Company');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Lead Template',
            'Lead',
            'SOQL',
            'SELECT Id, FirstName, LastName, Company, Email FROM Lead WHERE Id = :recordId',
            null,
            '068000000000018AAA',
            false,
            false,
            false
        );

        // When: Building envelope for Lead
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            lead.Id,
            template,
            'PDF',
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: Parents map should contain LeadId with correct format
        Assert.isNotNull(env.parents, 'Parents map should exist');
        Assert.areEqual(lead.Id, env.parents.get('LeadId'), 'LeadId should be set with key "LeadId"');

        // Verify no other parent types present
        Assert.isTrue(
            !env.parents.containsKey('AccountId') || env.parents.get('AccountId') == null,
            'AccountId should not be present for Lead'
        );
    }

    @isTest
    static void testExtractParentIds_ContactWithAccount_ReturnsMultiParent() {
        // Given: Contact with Account parent relationship
        Account acc = DocgenTestDataFactory.createAccount('Parent Account');
        Contact contact = DocgenTestDataFactory.createContact('Related', 'Contact', acc.Id);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Contact with Account Template',
            'Contact',
            'SOQL',
            'SELECT Id, FirstName, LastName, AccountId, Email FROM Contact WHERE Id = :recordId',
            null,
            '068000000000019AAA',
            false,
            false,
            false
        );

        // When: Building envelope for Contact with Account
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            contact.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Both ContactId and AccountId should be present
        Assert.isNotNull(env.parents, 'Parents map should exist');
        Assert.areEqual(contact.Id, env.parents.get('ContactId'), 'ContactId should be set');
        Assert.areEqual(acc.Id, env.parents.get('AccountId'), 'AccountId should be extracted from Contact data');
    }

    @isTest
    static void testExtractParentIds_DynamicKeyFormat() {
        // Given: Different object types
        Account acc = DocgenTestDataFactory.createAccount('Test Account');
        Contact contact = DocgenTestDataFactory.createContact(acc.Id);
        Lead lead = DocgenTestDataFactory.createLead('Test', 'Lead', 'Test Co');

        // Create templates for each
        Docgen_Template__c accTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Account Dynamic Test',
            'Account',
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000020AAA',
            false,
            false,
            false
        );

        Docgen_Template__c contactTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Contact Dynamic Test',
            'Contact',
            'SOQL',
            'SELECT Id, LastName, AccountId FROM Contact WHERE Id = :recordId',
            null,
            '068000000000021AAA',
            false,
            false,
            false
        );

        Docgen_Template__c leadTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Lead Dynamic Test',
            'Lead',
            'SOQL',
            'SELECT Id, LastName, Company FROM Lead WHERE Id = :recordId',
            null,
            '068000000000022AAA',
            false,
            false,
            false
        );

        // When: Building envelopes for each object type
        Test.startTest();
        DocgenEnvelopeService.Envelope accEnv = DocgenEnvelopeService.build(
            acc.Id, accTemplate, 'PDF', 'en-GB', 'Europe/London'
        );
        DocgenEnvelopeService.Envelope contactEnv = DocgenEnvelopeService.build(
            contact.Id, contactTemplate, 'PDF', 'en-GB', 'Europe/London'
        );
        DocgenEnvelopeService.Envelope leadEnv = DocgenEnvelopeService.build(
            lead.Id, leadTemplate, 'PDF', 'en-GB', 'Europe/London'
        );
        Test.stopTest();

        // Then: Each should have correct key format "{ObjectType}Id"
        Assert.areEqual(acc.Id, accEnv.parents.get('AccountId'), 'Account should use "AccountId" key');
        Assert.areEqual(contact.Id, contactEnv.parents.get('ContactId'), 'Contact should use "ContactId" key');
        Assert.areEqual(lead.Id, leadEnv.parents.get('LeadId'), 'Lead should use "LeadId" key');

        // Contact envelope should also have AccountId from relationship
        Assert.areEqual(acc.Id, contactEnv.parents.get('AccountId'), 'Contact envelope should include AccountId');
    }

    @isTest
    static void testExtractParentIds_OpportunityWithAccount_VerifyBothParents() {
        // Given: Opportunity with Account (verify existing behavior still works)
        Account acc = DocgenTestDataFactory.createAccount('Opportunity Account');
        Opportunity opp = DocgenTestDataFactory.createOpportunity('Multi-Parent Opp', acc.Id);

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Opp Multi-Parent Template',
            'Opportunity',
            'SOQL',
            'SELECT Id, Name, Amount, AccountId FROM Opportunity WHERE Id = :recordId',
            null,
            '068000000000023AAA',
            false,
            false,
            false
        );

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.build(
            opp.Id,
            template,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Both OpportunityId and AccountId should be present (backward compatibility)
        Assert.isNotNull(env.parents, 'Parents map should exist');
        Assert.areEqual(opp.Id, env.parents.get('OpportunityId'), 'OpportunityId should be set');
        Assert.areEqual(acc.Id, env.parents.get('AccountId'), 'AccountId should be extracted from Opportunity');

        // Verify map doesn't contain extra null keys for unsupported objects
        // After refactoring, map should only contain keys for actual parents
        Integer parentCount = 0;
        for (String parentId : env.parents.values()) {
            if (parentId != null && parentId != '') {
                parentCount++;
            }
        }
        Assert.areEqual(2, parentCount, 'Should have exactly 2 non-null parents (Opportunity and Account)');
    }

    // ========== T-20: Composite Document Support Tests ==========

    @isTest
    static void testBuildForCompositeWithTwoNamespaces() {
        // Given: Composite document with 2 templates (Account, Terms)
        Account acc = DocgenTestDataFactory.createAccount('Composite Test Account');

        // Create templates for each namespace
        Docgen_Template__c accountTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Account Summary',
            null,
            'SOQL',
            'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            null,
            '068000000000024AAA',
            false,
            false,
            false
        );

        Docgen_Template__c termsTemplate = DocgenTestDataFactory.createCustomTemplate(
            'Terms and Conditions',
            null,
            'MockCustomProvider'
        );

        // Create composite document
        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Concatenate Templates',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true,
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert composite;

        // Create junction records
        Composite_Document_Template__c junction1 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = accountTemplate.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );

        Composite_Document_Template__c junction2 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = termsTemplate.Id,
            Namespace__c = 'Terms',
            Sequence__c = 20,
            IsActive__c = true
        );
        insert new List<Composite_Document_Template__c>{ junction1, junction2 };

        // When: Building composite envelope
        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Envelope should contain both namespaces
        Assert.isNotNull(env, 'Envelope should not be null');
        Assert.isNotNull(env.data, 'Data should not be null');
        Assert.areEqual('PDF', env.outputFormat, 'Output format should be PDF');
        Assert.areEqual('en-GB', env.locale, 'Locale should match');
        Assert.areEqual('Europe/London', env.timezone, 'Timezone should match');

        // Verify both namespaces present in data
        Assert.isTrue(env.data.containsKey('Account'), 'Data should contain Account namespace');
        Assert.isTrue(env.data.containsKey('Terms'), 'Data should contain Terms namespace');

        // Verify composite-specific fields
        Assert.areEqual(composite.Id, env.compositeDocumentId, 'Composite document ID should be set');
        Assert.isNotNull(env.requestHash, 'RequestHash should be computed');
        Assert.isTrue(env.requestHash.startsWith('sha256:'), 'Hash should have sha256 prefix');
    }

    @isTest
    static void testBuildForCompositeOwnTemplateStrategy() {
        // Given: Composite with "Own Template" strategy
        Account acc = DocgenTestDataFactory.createAccount('Own Template Account');

        Docgen_Template__c accountTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Account Data Provider',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000026AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '068000000000027AAA',
            StoreMergedDocx__c = true,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert composite;

        // Create junction for data provider (template strategy uses composite's template)
        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = accountTemplate.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );
        insert junction;

        // When: Building envelope with Own Template strategy
        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            recordIds,
            'PDF',
            'en-US',
            'America/New_York'
        );
        Test.stopTest();

        // Then: templateId should be set, templates should be null
        Assert.areEqual('068000000000027AAA', env.templateId, 'Template ID should match composite template');
        Assert.isNull(env.templates, 'Templates array should be null for Own Template strategy');
        Assert.areEqual('Own Template', env.templateStrategy, 'Template strategy should be Own Template');
    }

    @isTest
    static void testBuildForCompositeOwnTemplateIncludesWatermarkOptions() {
        // Given: Own Template composite with composite-level watermark settings
        Account acc = DocgenTestDataFactory.createAccount('Own Template Watermark Account');

        Docgen_Template__c accountTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Own Template Watermark Data',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000126AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '068000000000127AAA',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true,
            PrimaryParent__c = 'Account',
            IsActive__c = true,
            Watermark_Text__c = 'DRAFT',
            Watermark_Condition_Field__c = 'Account.Name',
            Watermark_Style__c = 'Font: Courier\nWidth: 350\nHeight: 50\nRotation: -45\nColor code: #808080'
        );
        insert composite;

        insert new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = accountTemplate.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            new Map<String, Id>{ 'accountId' => acc.Id },
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Composite watermark settings should be sent to the backend
        Assert.areEqual('DRAFT', env.options.get('watermarkText'), 'Watermark text should be included');
        Assert.areEqual(
            composite.Watermark_Style__c,
            env.options.get('watermarkStyle'),
            'Watermark style should be included'
        );
    }

    @isTest
    static void testBuildForCompositeConcatenateStrategy() {
        // Given: Composite with "Concatenate Templates" strategy
        Account acc = DocgenTestDataFactory.createAccount('Concat Account');

        Docgen_Template__c template1 = DocgenTestDataFactory.createTemplateWithConfig(
            'Section 1',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000028AAA',
            false,
            false,
            false
        );

        Docgen_Template__c template2 = DocgenTestDataFactory.createTemplateWithConfig(
            'Section 2',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000029AAA',
            false,
            false,
            false
        );

        Docgen_Template__c template3 = DocgenTestDataFactory.createTemplateWithConfig(
            'Section 3',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000030AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Concatenate Templates',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true,
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert composite;

        // Create junctions with different sequence orders
        Composite_Document_Template__c junction1 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template2.Id,
            Namespace__c = 'Section2',
            Sequence__c = 20,
            IsActive__c = true
        );

        Composite_Document_Template__c junction2 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template1.Id,
            Namespace__c = 'Section1',
            Sequence__c = 10,
            IsActive__c = true
        );

        Composite_Document_Template__c junction3 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template3.Id,
            Namespace__c = 'Section3',
            Sequence__c = 30,
            IsActive__c = true
        );
        insert new List<Composite_Document_Template__c>{ junction1, junction2, junction3 };

        // When: Building envelope with Concatenate Templates strategy
        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: templates array should be populated and ordered by sequence
        Assert.isNull(env.templateId, 'Template ID should be null for Concatenate Templates strategy');
        Assert.isNotNull(env.templates, 'Templates array should not be null');
        Assert.areEqual(3, env.templates.size(), 'Should have 3 templates');
        Assert.areEqual('Concatenate Templates', env.templateStrategy, 'Template strategy should be Concatenate Templates');

        // Verify ordering by sequence (10, 20, 30)
        Assert.areEqual('068000000000028AAA', env.templates[0].templateId, 'First template should be sequence 10');
        Assert.areEqual('Section1', env.templates[0].namespace, 'First namespace should be Section1');
        Assert.areEqual(10, env.templates[0].sequence, 'First sequence should be 10');

        Assert.areEqual('068000000000029AAA', env.templates[1].templateId, 'Second template should be sequence 20');
        Assert.areEqual('Section2', env.templates[1].namespace, 'Second namespace should be Section2');
        Assert.areEqual(20, env.templates[1].sequence, 'Second sequence should be 20');

        Assert.areEqual('068000000000030AAA', env.templates[2].templateId, 'Third template should be sequence 30');
        Assert.areEqual('Section3', env.templates[2].namespace, 'Third namespace should be Section3');
        Assert.areEqual(30, env.templates[2].sequence, 'Third sequence should be 30');
    }

    @isTest
    static void testBuildForCompositeConcatenateIncludesWatermarkOptions() {
        // Given: Concatenate composite with multiple templates and composite-level watermark settings
        Account acc = DocgenTestDataFactory.createAccount('Concat Watermark Account');

        Docgen_Template__c template1 = DocgenTestDataFactory.createTemplateWithConfig(
            'Concat Watermark Section 1',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000128AAA',
            false,
            false,
            false
        );

        Docgen_Template__c template2 = DocgenTestDataFactory.createTemplateWithConfig(
            'Concat Watermark Section 2',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000129AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Concatenate Templates',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true,
            PrimaryParent__c = 'Account',
            IsActive__c = true,
            Watermark_Text__c = 'DRAFT',
            Watermark_Condition_Field__c = 'Account.Name',
            Watermark_Style__c = 'Font: Courier\nWidth: 350\nHeight: 50\nRotation: -45\nColor code: #808080'
        );
        insert composite;

        insert new List<Composite_Document_Template__c>{
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = template1.Id,
                Namespace__c = 'Account',
                Sequence__c = 10,
                IsActive__c = true
            ),
            new Composite_Document_Template__c(
                Composite_Document__c = composite.Id,
                Document_Template__c = template2.Id,
                Namespace__c = 'Terms',
                Sequence__c = 20,
                IsActive__c = true
            )
        };

        // When: Building envelope
        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            new Map<String, Id>{ 'accountId' => acc.Id },
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Composite watermark settings should be sent once at request-options level
        Assert.areEqual('DRAFT', env.options.get('watermarkText'), 'Watermark text should be included');
        Assert.areEqual(
            composite.Watermark_Style__c,
            env.options.get('watermarkStyle'),
            'Watermark style should be included'
        );
        Assert.areEqual(2, env.templates.size(), 'Concatenate strategy should still include both child templates');
    }

    @isTest
    static void testExtractParentIdsFromCompositeData() {
        // Given: Composite data with Account and Contact namespaces
        Account acc = DocgenTestDataFactory.createAccount('Parent Account');
        Contact contact = DocgenTestDataFactory.createContact('Test', 'Contact', acc.Id);

        Docgen_Template__c accountTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Account Template',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000031AAA',
            false,
            false,
            false
        );

        Docgen_Template__c contactTemplate = DocgenTestDataFactory.createTemplateWithConfig(
            'Contact Template',
            null,
            'SOQL',
            'SELECT Id, FirstName, LastName, AccountId FROM Contact WHERE Id = :recordId',
            null,
            '068000000000032AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Concatenate Templates',
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert composite;

        // Create junctions - Account first (sequence 10), Contact second (sequence 20)
        Composite_Document_Template__c junction1 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = accountTemplate.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );

        Composite_Document_Template__c junction2 = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = contactTemplate.Id,
            Namespace__c = 'Contact',
            Sequence__c = 20,
            IsActive__c = true
        );
        insert new List<Composite_Document_Template__c>{ junction1, junction2 };

        // When: Building composite envelope
        Map<String, Id> recordIds = new Map<String, Id>{
            'accountId' => acc.Id,
            'contactId' => contact.Id
        };

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Parents map should contain both AccountId and ContactId
        Assert.isNotNull(env.parents, 'Parents map should not be null');
        Assert.areEqual(acc.Id, env.parents.get('AccountId'), 'AccountId should be in parents');
        Assert.areEqual(contact.Id, env.parents.get('ContactId'), 'ContactId should be in parents');

        // Verify first namespace wins if duplicate (Account namespace comes first by sequence)
        // Since both namespaces have Account data, the first one (sequence 10) should win
    }

    @isTest
    static void testCompositeHashComputation() {
        // Given: Two different composites with same data
        Account acc = DocgenTestDataFactory.createAccount('Hash Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Hash Template',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000033AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite1 = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '068000000000034AAA',
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );

        Composite_Document__c composite2 = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '068000000000035AAA',
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert new List<Composite_Document__c>{ composite1, composite2 };

        Composite_Document_Template__c junction1 = new Composite_Document_Template__c(
            Composite_Document__c = composite1.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );

        Composite_Document_Template__c junction2 = new Composite_Document_Template__c(
            Composite_Document__c = composite2.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );
        insert new List<Composite_Document_Template__c>{ junction1, junction2 };

        // When: Building envelopes for both composites with same recordIds
        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        Test.startTest();
        DocgenEnvelopeService.Envelope env1 = DocgenEnvelopeService.buildForComposite(
            composite1.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );

        DocgenEnvelopeService.Envelope env2 = DocgenEnvelopeService.buildForComposite(
            composite2.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );

        // Building same composite twice with same recordIds
        DocgenEnvelopeService.Envelope env3 = DocgenEnvelopeService.buildForComposite(
            composite1.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Different compositeDocIds should produce different hashes
        Assert.areNotEqual(env1.requestHash, env2.requestHash,
            'Different composite document IDs should produce different hashes');

        // Then: Same composite with same recordIds should produce same hash (idempotency)
        Assert.areEqual(env1.requestHash, env3.requestHash,
            'Same composite with same recordIds should produce identical hash');

        // Verify hash format
        Assert.isTrue(env1.requestHash.startsWith('sha256:'), 'Hash should have sha256 prefix');
        Assert.areEqual(71, env1.requestHash.length(), 'Hash should be 71 chars (sha256: + 64 hex chars)');
    }

    @isTest
    static void testCompositeOptionsMapping() {
        // Given: Composite with specific option settings
        Account acc = DocgenTestDataFactory.createAccount('Options Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Options Template',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000036AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '068000000000037AAA',
            StoreMergedDocx__c = true,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert composite;

        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );
        insert junction;

        // When: Building composite envelope
        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            recordIds,
            'DOCX',
            'en-US',
            'America/Los_Angeles'
        );
        Test.stopTest();

        // Then: Options should match composite settings
        Assert.isNotNull(env.options, 'Options should not be null');
        Assert.isTrue((Boolean) env.options.get('storeMergedDocx'), 'StoreMergedDocx should be true');
        Assert.isFalse((Boolean) env.options.get('returnDocxToBrowser'), 'ReturnDocxToBrowser should be false');
        Assert.areEqual('DOCX', env.outputFormat, 'Output format should be DOCX');
    }

    @isTest
    static void testCompositeOutputFileName() {
        // Given: Composite document for filename generation
        Account acc = DocgenTestDataFactory.createAccount('Filename Test Account');

        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Filename Template',
            null,
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000038AAA',
            false,
            false,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Template_Strategy__c = 'Own Template',
            TemplateContentVersionId__c = '068000000000039AAA',
            PrimaryParent__c = 'Account',
            IsActive__c = true
        );
        insert composite;

        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );
        insert junction;

        // When: Building composite envelope
        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        // Then: Output filename should follow format: Composite_{Name}_{timestamp}.{ext}
        Assert.isNotNull(env.outputFileName, 'Output filename should not be null');
        Assert.isTrue(env.outputFileName.startsWith('Composite_'), 'Filename should start with Composite_');
        Assert.isTrue(env.outputFileName.contains('CD') || env.outputFileName.contains('_00'),
            'Filename should contain composite auto-number');
        Assert.isTrue(env.outputFileName.endsWith('.pdf'), 'Filename should end with .pdf');

        // Should contain timestamp pattern (contains underscore and 8 digits for date)
        // Pattern check: Composite_CD*_yyyyMMdd_HHmmss.pdf
        Assert.isTrue(
            env.outputFileName.length() > 30,
            'Filename should be long enough to contain Composite_ + name + timestamp + .pdf'
        );
    }

    /**
     * Test: Composite output file name can be resolved from a configured envelope data path.
     */
    @isTest
    static void testCompositeOutputFileNameFromConfiguredField() {
        Account acc = DocgenTestDataFactory.createAccount('Composite Contract Name');
        Docgen_Template__c template = DocgenTestDataFactory.createTemplateWithConfig(
            'Composite Filename Template',
            'Account',
            'SOQL',
            'SELECT Id, Name FROM Account WHERE Id = :recordId',
            null,
            '068000000000040AAA',
            false,
            true,
            false
        );

        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Composite with configured output file name',
            Template_Strategy__c = 'Concatenate Templates',
            PrimaryParent__c = 'Account',
            Output_File_Name_Field__c = 'Account.Name',
            IsActive__c = true
        );
        insert composite;

        insert new Composite_Document_Template__c(
            Composite_Document__c = composite.Id,
            Document_Template__c = template.Id,
            Namespace__c = 'Account',
            Sequence__c = 10,
            IsActive__c = true
        );

        Map<String, Id> recordIds = new Map<String, Id>{ 'accountId' => acc.Id };

        Test.startTest();
        DocgenEnvelopeService.Envelope env = DocgenEnvelopeService.buildForComposite(
            composite.Id,
            recordIds,
            'PDF',
            'en-GB',
            'Europe/London'
        );
        Test.stopTest();

        Assert.areEqual(
            'Composite Contract Name.pdf',
            env.outputFileName,
            'Configured composite file name should resolve from namespaced data and enforce extension'
        );
    }
}
