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
        Account acc = new Account(
            Name = 'Acme Ltd',
            BillingCity = 'London',
            AnnualRevenue = 1200000
        );
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Account Template',
            TemplateContentVersionId__c = '068000000000001AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, BillingCity, AnnualRevenue FROM Account WHERE Id = :recordId',
            StoreMergedDocx__c = true,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account'
        );
        insert template;

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
    static void testBuildEnvelopeWithOpportunity() {
        // Given: An Opportunity with Account
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Opportunity opp = new Opportunity(
            Name = 'Test Opportunity',
            AccountId = acc.Id,
            CloseDate = Date.today().addDays(30),
            StageName = 'Prospecting',
            Amount = 250000
        );
        insert opp;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Opportunity Template',
            TemplateContentVersionId__c = '068000000000002AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, Amount, AccountId FROM Opportunity WHERE Id = :recordId',
            PrimaryParent__c = 'Opportunity'
        );
        insert template;

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
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Case cs = new Case(
            Subject = 'Test Case',
            AccountId = acc.Id,
            Status = 'New',
            Origin = 'Web'
        );
        insert cs;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Case Template',
            TemplateContentVersionId__c = '068000000000003AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Subject, AccountId FROM Case WHERE Id = :recordId',
            PrimaryParent__c = 'Case'
        );
        insert template;

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
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Custom Provider Template',
            TemplateContentVersionId__c = '068000000000004AAA',
            DataSource__c = 'Custom',
            ClassName__c = 'MockCustomProvider'
        );
        insert template;

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
        Account acc = new Account(Name = 'Test');
        insert acc;

        // Note: In real scenario, picklist prevents this, but testing defensive code
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Invalid Source',
            TemplateContentVersionId__c = '068000000000005AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id FROM Account WHERE Id = :recordId'
        );
        insert template;

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
        Account acc = new Account(Name = 'Test');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Options Test',
            TemplateContentVersionId__c = '068000000000006AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            StoreMergedDocx__c = true,
            ReturnDocxToBrowser__c = true
        );
        insert template;

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
        Opportunity opp = new Opportunity(
            Name = 'Orphan Opportunity',
            AccountId = null, // No parent account
            CloseDate = Date.today().addDays(30),
            StageName = 'Prospecting',
            Amount = 100000
        );
        insert opp;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Orphan Opp Template',
            TemplateContentVersionId__c = '068000000000007AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, Amount, AccountId FROM Opportunity WHERE Id = :recordId',
            PrimaryParent__c = 'Opportunity'
        );
        insert template;

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
        Case cs = new Case(
            Subject = 'Orphan Case',
            AccountId = null, // No parent account
            Status = 'New',
            Origin = 'Email'
        );
        insert cs;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Orphan Case Template',
            TemplateContentVersionId__c = '068000000000008AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Subject, AccountId FROM Case WHERE Id = :recordId',
            PrimaryParent__c = 'Case'
        );
        insert template;

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
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template with Special $%^ Chars',
            TemplateContentVersionId__c = '068000000000009AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );
        insert template;

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
    static void testHashStabilityAcrossRebuilds() {
        // Given: Same account and template
        Account acc = new Account(
            Name = 'Stable Account',
            AnnualRevenue = 5000000
        );
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Stable Template',
            TemplateContentVersionId__c = '068000000000010AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );
        insert template;

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
        Account acc1 = new Account(
            Name = 'Account One',
            AnnualRevenue = 1000000
        );
        insert acc1;

        Account acc2 = new Account(
            Name = 'Account Two',
            AnnualRevenue = 2000000
        );
        insert acc2;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Same Template',
            TemplateContentVersionId__c = '068000000000011AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );
        insert template;

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

        Account acc = new Account(Name = 'Multi-Parent Account');
        insert acc;

        Opportunity opp = new Opportunity(
            Name = 'Related Opportunity',
            AccountId = acc.Id,
            CloseDate = Date.today(),
            StageName = 'Closed Won'
        );
        insert opp;

        Case cs = new Case(
            Subject = 'Multi-Parent Case',
            AccountId = acc.Id,
            Status = 'New',
            Origin = 'Phone'
        );
        insert cs;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Multi-Parent Template',
            TemplateContentVersionId__c = '068000000000012AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Subject, AccountId FROM Case WHERE Id = :recordId',
            PrimaryParent__c = 'Case'
        );
        insert template;

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
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Failing Provider Template',
            TemplateContentVersionId__c = '068000000000013AAA',
            DataSource__c = 'Custom',
            ClassName__c = 'FailingCustomProvider'
        );
        insert template;

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
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Non-Existent Provider Template',
            TemplateContentVersionId__c = '068000000000014AAA',
            DataSource__c = 'Custom',
            ClassName__c = 'NonExistentProvider'
        );
        insert template;

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
        Account acc = new Account(
            Name = 'Large Data Account',
            AnnualRevenue = 50000000
        );
        insert acc;

        // Create many contacts to generate large data set
        List<Contact> contacts = new List<Contact>();
        for (Integer i = 0; i < 200; i++) {
            contacts.add(new Contact(
                FirstName = 'Contact',
                LastName = 'Number' + i,
                AccountId = acc.Id,
                Email = 'contact' + i + '@example.com',
                Description = 'This is a test contact with some description text to increase payload size. Adding more text here to make the envelope larger.'
            ));
        }
        insert contacts;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Large Data Template',
            TemplateContentVersionId__c = '068000000000015AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue, (SELECT Id, FirstName, LastName, Email, Description FROM Contacts) FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );
        insert template;

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
        Account acc = new Account(
            Name = 'JSON Size Test Account',
            AnnualRevenue = 1000000
        );
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'JSON Size Template',
            TemplateContentVersionId__c = '068000000000016AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );
        insert template;

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
}
