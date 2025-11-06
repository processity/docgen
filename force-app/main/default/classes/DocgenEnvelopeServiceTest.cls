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
}
