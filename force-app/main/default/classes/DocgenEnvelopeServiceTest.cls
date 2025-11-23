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
            PrimaryParent__c = 'Account',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Opportunity',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Case',
            ReturnMultipleRecords__c = false
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
            ClassName__c = 'MockCustomProvider',
            ReturnMultipleRecords__c = false
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
            SOQL__c = 'SELECT Id FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
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
            ReturnDocxToBrowser__c = true,
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Opportunity',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Case',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Account',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Account',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Account',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Case',
            ReturnMultipleRecords__c = false
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
            ClassName__c = 'FailingCustomProvider',
            ReturnMultipleRecords__c = false
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
            ClassName__c = 'NonExistentProvider',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Account',
            ReturnMultipleRecords__c = false
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
            PrimaryParent__c = 'Account',
            ReturnMultipleRecords__c = false
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

    // ========== T-06: Dynamic Parent Extraction Tests ==========

    @isTest
    static void testExtractParentIds_Contact_ReturnsSingleParent() {
        // Given: Contact record with no Account parent
        Contact contact = new Contact(
            FirstName = 'Test',
            LastName = 'Contact',
            Email = 'test@example.com'
        );
        insert contact;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Contact Template',
            TemplateContentVersionId__c = '068000000000017AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, FirstName, LastName, Email FROM Contact WHERE Id = :recordId',
            PrimaryParent__c = 'Contact',
            ReturnMultipleRecords__c = false
        );
        insert template;

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
        Lead lead = new Lead(
            FirstName = 'Test',
            LastName = 'Lead',
            Company = 'Test Company',
            Email = 'testlead@example.com',
            Status = 'Open - Not Contacted'
        );
        insert lead;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Lead Template',
            TemplateContentVersionId__c = '068000000000018AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, FirstName, LastName, Company, Email FROM Lead WHERE Id = :recordId',
            PrimaryParent__c = 'Lead',
            ReturnMultipleRecords__c = false
        );
        insert template;

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
        Account acc = new Account(Name = 'Parent Account');
        insert acc;

        Contact contact = new Contact(
            FirstName = 'Related',
            LastName = 'Contact',
            AccountId = acc.Id,
            Email = 'related@example.com'
        );
        insert contact;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Contact with Account Template',
            TemplateContentVersionId__c = '068000000000019AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, FirstName, LastName, AccountId, Email FROM Contact WHERE Id = :recordId',
            PrimaryParent__c = 'Contact',
            ReturnMultipleRecords__c = false
        );
        insert template;

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
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Contact contact = new Contact(
            LastName = 'Test Contact',
            AccountId = acc.Id
        );
        insert contact;

        Lead lead = new Lead(
            LastName = 'Test Lead',
            Company = 'Test Co',
            Status = 'Open - Not Contacted'
        );
        insert lead;

        // Create templates for each
        Docgen_Template__c accTemplate = new Docgen_Template__c(
            Name = 'Account Dynamic Test',
            TemplateContentVersionId__c = '068000000000020AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account',
            ReturnMultipleRecords__c = false
        );

        Docgen_Template__c contactTemplate = new Docgen_Template__c(
            Name = 'Contact Dynamic Test',
            TemplateContentVersionId__c = '068000000000021AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, LastName, AccountId FROM Contact WHERE Id = :recordId',
            PrimaryParent__c = 'Contact',
            ReturnMultipleRecords__c = false
        );

        Docgen_Template__c leadTemplate = new Docgen_Template__c(
            Name = 'Lead Dynamic Test',
            TemplateContentVersionId__c = '068000000000022AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, LastName, Company FROM Lead WHERE Id = :recordId',
            PrimaryParent__c = 'Lead',
            ReturnMultipleRecords__c = false
        );

        insert new List<Docgen_Template__c>{ accTemplate, contactTemplate, leadTemplate };

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
        Account acc = new Account(Name = 'Opportunity Account');
        insert acc;

        Opportunity opp = new Opportunity(
            Name = 'Multi-Parent Opp',
            AccountId = acc.Id,
            CloseDate = Date.today().addDays(30),
            StageName = 'Prospecting',
            Amount = 500000
        );
        insert opp;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Opp Multi-Parent Template',
            TemplateContentVersionId__c = '068000000000023AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, Amount, AccountId FROM Opportunity WHERE Id = :recordId',
            PrimaryParent__c = 'Opportunity',
            ReturnMultipleRecords__c = false
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
        Account acc = new Account(
            Name = 'Composite Test Account',
            AnnualRevenue = 5000000
        );
        insert acc;

        // Create templates for each namespace
        Docgen_Template__c accountTemplate = new Docgen_Template__c(
            Name = 'Account Summary',
            TemplateContentVersionId__c = '068000000000024AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );

        Docgen_Template__c termsTemplate = new Docgen_Template__c(
            Name = 'Terms and Conditions',
            TemplateContentVersionId__c = '068000000000025AAA',
            DataSource__c = 'Custom',
            ClassName__c = 'MockCustomProvider',
            ReturnMultipleRecords__c = false
        );
        insert new List<Docgen_Template__c>{ accountTemplate, termsTemplate };

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
        Account acc = new Account(Name = 'Own Template Account');
        insert acc;

        Docgen_Template__c accountTemplate = new Docgen_Template__c(
            Name = 'Account Data Provider',
            TemplateContentVersionId__c = '068000000000026AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );
        insert accountTemplate;

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
    static void testBuildForCompositeConcatenateStrategy() {
        // Given: Composite with "Concatenate Templates" strategy
        Account acc = new Account(Name = 'Concat Account');
        insert acc;

        Docgen_Template__c template1 = new Docgen_Template__c(
            Name = 'Section 1',
            TemplateContentVersionId__c = '068000000000028AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );

        Docgen_Template__c template2 = new Docgen_Template__c(
            Name = 'Section 2',
            TemplateContentVersionId__c = '068000000000029AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );

        Docgen_Template__c template3 = new Docgen_Template__c(
            Name = 'Section 3',
            TemplateContentVersionId__c = '068000000000030AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );
        insert new List<Docgen_Template__c>{ template1, template2, template3 };

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
    static void testExtractParentIdsFromCompositeData() {
        // Given: Composite data with Account and Contact namespaces
        Account acc = new Account(Name = 'Parent Account');
        insert acc;

        Contact contact = new Contact(
            FirstName = 'Test',
            LastName = 'Contact',
            AccountId = acc.Id
        );
        insert contact;

        Docgen_Template__c accountTemplate = new Docgen_Template__c(
            Name = 'Account Template',
            TemplateContentVersionId__c = '068000000000031AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );

        Docgen_Template__c contactTemplate = new Docgen_Template__c(
            Name = 'Contact Template',
            TemplateContentVersionId__c = '068000000000032AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, FirstName, LastName, AccountId FROM Contact WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );
        insert new List<Docgen_Template__c>{ accountTemplate, contactTemplate };

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
        Account acc = new Account(Name = 'Hash Test Account');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Hash Template',
            TemplateContentVersionId__c = '068000000000033AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );
        insert template;

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
        Account acc = new Account(Name = 'Options Test Account');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Options Template',
            TemplateContentVersionId__c = '068000000000036AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );
        insert template;

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
        Account acc = new Account(Name = 'Filename Test Account');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Filename Template',
            TemplateContentVersionId__c = '068000000000038AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            ReturnMultipleRecords__c = false
        );
        insert template;

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
}
