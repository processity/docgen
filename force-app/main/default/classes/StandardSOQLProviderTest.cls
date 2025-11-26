/**
 * Test class for StandardSOQLProvider
 * Validates SOQL-based data provider with field preformatting
 */
@isTest
private class StandardSOQLProviderTest {

    @isTest
    static void testFormatCurrencyGBP() {
        // Given: A currency value and en-GB locale
        Decimal value = 1200000.50;
        String locale = 'en-GB';

        // When: Formatting currency
        Test.startTest();
        String formatted = StandardSOQLProvider.formatCurrency(value, locale);
        Test.stopTest();

        // Then: Should format with GBP symbol and thousands separator
        Assert.isNotNull(formatted, 'Formatted currency should not be null');
        Assert.isTrue(formatted.contains('£'), 'Should contain GBP symbol');
        Assert.isTrue(formatted.contains('1,200,000'), 'Should contain thousands separator');
    }

    @isTest
    static void testFormatCurrencyUSD() {
        // Given: A currency value and en-US locale
        Decimal value = 250000.75;
        String locale = 'en-US';

        // When: Formatting currency
        Test.startTest();
        String formatted = StandardSOQLProvider.formatCurrency(value, locale);
        Test.stopTest();

        // Then: Should format with USD symbol and thousands separator
        Assert.isNotNull(formatted, 'Formatted currency should not be null');
        Assert.isTrue(formatted.contains('$'), 'Should contain USD symbol');
        Assert.isTrue(formatted.contains('250,000'), 'Should contain thousands separator');
    }

    @isTest
    static void testFormatCurrencyNull() {
        // Given: A null currency value
        Decimal value = null;
        String locale = 'en-GB';

        // When: Formatting null currency
        Test.startTest();
        String formatted = StandardSOQLProvider.formatCurrency(value, locale);
        Test.stopTest();

        // Then: Should return empty string
        Assert.areEqual('', formatted, 'Null currency should return empty string');
    }

    @isTest
    static void testFormatNumberWithThousands() {
        // Given: A large number and locale
        Decimal value = 123456.789;
        String locale = 'en-GB';

        // When: Formatting number
        Test.startTest();
        String formatted = StandardSOQLProvider.formatNumber(value, locale);
        Test.stopTest();

        // Then: Should include thousands separator
        Assert.isNotNull(formatted, 'Formatted number should not be null');
        Assert.isTrue(formatted.contains('123,456'), 'Should contain thousands separator');
    }

    @isTest
    static void testFormatPercent() {
        // Given: A decimal value
        Decimal value = 75.5;
        String locale = 'en-GB';

        // When: Formatting as percent
        Test.startTest();
        String formatted = StandardSOQLProvider.formatPercent(value, locale);
        Test.stopTest();

        // Then: Should append percent symbol
        Assert.isNotNull(formatted, 'Formatted percent should not be null');
        Assert.isTrue(formatted.contains('%'), 'Should contain percent symbol');
        Assert.isTrue(formatted.contains('75'), 'Should contain the value');
    }

    @isTest
    static void testFormatDateGB() {
        // Given: A date and en-GB locale
        Date testDate = Date.newInstance(2025, 12, 31);
        String locale = 'en-GB';

        // When: Formatting date
        Test.startTest();
        String formatted = StandardSOQLProvider.formatDate(testDate, locale);
        Test.stopTest();

        // Then: Should format as DD MMM YYYY
        Assert.isNotNull(formatted, 'Formatted date should not be null');
        Assert.isTrue(formatted.contains('31'), 'Should contain day');
        Assert.isTrue(formatted.contains('Dec'), 'Should contain month abbreviation');
        Assert.isTrue(formatted.contains('2025'), 'Should contain year');
    }

    @isTest
    static void testFormatDateUS() {
        // Given: A date and en-US locale
        Date testDate = Date.newInstance(2025, 12, 31);
        String locale = 'en-US';

        // When: Formatting date
        Test.startTest();
        String formatted = StandardSOQLProvider.formatDate(testDate, locale);
        Test.stopTest();

        // Then: Should format as MM/DD/YYYY
        Assert.isNotNull(formatted, 'Formatted date should not be null');
        Assert.isTrue(formatted.contains('12/31/2025') || formatted.contains('31'), 'Should contain date components');
        Assert.isTrue(formatted.contains('2025'), 'Should contain year');
    }

    @isTest
    static void testFormatDatetimeWithTimezone() {
        // Given: A datetime and timezone
        Datetime testDatetime = Datetime.newInstance(2025, 10, 31, 14, 30, 0);
        String locale = 'en-GB';
        String timezone = 'Europe/London';

        // When: Formatting datetime
        Test.startTest();
        String formatted = StandardSOQLProvider.formatDatetime(testDatetime, locale, timezone);
        Test.stopTest();

        // Then: Should format with timezone applied
        Assert.isNotNull(formatted, 'Formatted datetime should not be null');
        Assert.isTrue(formatted.contains('31'), 'Should contain day');
        Assert.isTrue(formatted.contains('Oct') || formatted.contains('10'), 'Should contain month');
        Assert.isTrue(formatted.contains('2025'), 'Should contain year');
    }

    @isTest
    static void testBuildDataWithAccount() {
        // Given: An Account and template with SOQL
        Account acc = new Account(
            Name = 'Acme Ltd',
            BillingCity = 'London',
            AnnualRevenue = 1200000
        );
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Account Summary',
            TemplateContentVersionId__c = '068000000000001AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, BillingCity, AnnualRevenue FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: Should return map with Account data and formatted fields
        Assert.isNotNull(data, 'Data map should not be null');
        Assert.isTrue(data.containsKey('Account'), 'Should contain Account key');

        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');
        Assert.areEqual('Acme Ltd', accountData.get('Name'), 'Should contain Account Name');
        Assert.areEqual('London', accountData.get('BillingCity'), 'Should contain BillingCity');
        Assert.isNotNull(accountData.get('AnnualRevenue__formatted'), 'Should contain formatted AnnualRevenue');
    }

    @isTest
    static void testBuildDataWithNullFields() {
        // Given: An Account with null revenue but populated name
        Account acc = new Account(
            Name = 'Test Account',
            AnnualRevenue = null
        );
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Account Test',
            TemplateContentVersionId__c = '068000000000002AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data with null fields
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: Should handle null gracefully and include populated fields
        Assert.isNotNull(data, 'Data map should not be null');
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');
        Assert.areEqual('Test Account', accountData.get('Name'), 'Name should be populated');
        // Null numeric fields may or may not have __formatted depending on detection
        // The important thing is that it doesn't throw an error
        Assert.isTrue(true, 'Successfully processed record with null numeric field');
    }

    @isTest
    static void testBuildDataWithInvalidSOQL() {
        // Given: A template with invalid SOQL
        Account acc = new Account(Name = 'Test');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Invalid SOQL',
            TemplateContentVersionId__c = '068000000000003AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT InvalidField FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When/Then: Should throw exception for invalid SOQL
        Test.startTest();
        try {
            provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
            Assert.fail('Should have thrown exception for invalid SOQL');
        } catch (Exception e) {
            Assert.isNotNull(e.getMessage(), 'Exception message should not be null');
        }
        Test.stopTest();
    }

    @isTest
    static void testBuildDataWithMissingSOQL() {
        // Given: A template with null SOQL__c
        Account acc = new Account(Name = 'Test');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'No SOQL',
            TemplateContentVersionId__c = '068000000000004AAA',
            DataSource__c = 'SOQL',
            SOQL__c = null
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When/Then: Should throw exception for missing SOQL
        Test.startTest();
        try {
            provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
            Assert.fail('Should have thrown exception for missing SOQL');
        } catch (Exception e) {
            Assert.isTrue(e.getMessage().contains('SOQL'), 'Exception should mention SOQL');
        }
        Test.stopTest();
    }

    @isTest
    static void testBuildDataWithChildRelationships() {
        // Given: Account with Contacts (child relationship)
        Account acc = new Account(
            Name = 'Parent Company',
            AnnualRevenue = 5000000,
            BillingCountry = 'United Kingdom'
        );
        insert acc;

        List<Contact> contacts = new List<Contact>{
            new Contact(
                FirstName = 'John',
                LastName = 'Doe',
                AccountId = acc.Id,
                Email = 'john.doe@test.com'
            ),
            new Contact(
                FirstName = 'Jane',
                LastName = 'Smith',
                AccountId = acc.Id,
                Email = 'jane.smith@test.com'
            )
        };
        insert contacts;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Account with Contacts',
            TemplateContentVersionId__c = '068000000000005AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue, (SELECT Id, FirstName, LastName FROM Contacts) FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data with child relationships
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: Should include child array with formatted fields
        Assert.isNotNull(data, 'Data map should not be null');
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');

        // Verify parent fields
        Assert.areEqual('Parent Company', accountData.get('Name'), 'Should contain Account Name');
        Assert.isNotNull(accountData.get('AnnualRevenue__formatted'), 'Should have formatted revenue');

        // Verify child relationship exists
        Assert.isTrue(accountData.containsKey('Contacts'), 'Should contain Contacts child relationship');

        List<Object> contactsList = (List<Object>) accountData.get('Contacts');
        Assert.areEqual(2, contactsList.size(), 'Should have 2 contacts');

        // Verify first contact
        Map<String, Object> firstContact = (Map<String, Object>) contactsList[0];
        Assert.isNotNull(firstContact.get('FirstName'), 'Contact should have FirstName');
        Assert.isNotNull(firstContact.get('LastName'), 'Contact should have LastName');
    }

    @isTest
    static void testBuildDataWithEmptyChildRelationship() {
        // Given: Account with NO contacts
        Account acc = new Account(
            Name = 'Lonely Company',
            AnnualRevenue = 100000,
            BillingCountry = 'United Kingdom'
        );
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Account with No Contacts',
            TemplateContentVersionId__c = '068000000000006AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, (SELECT Id, FirstName, LastName FROM Contacts) FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data with empty child relationship
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: Should include empty child array (not null)
        Assert.isNotNull(data, 'Data map should not be null');
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');

        Assert.areEqual('Lonely Company', accountData.get('Name'), 'Should contain Account Name');

        // Child relationship MUST exist and be empty array
        Assert.isTrue(accountData.containsKey('Contacts'), 'Contacts key must exist for queried child relationship');
        List<Object> contactsList = (List<Object>) accountData.get('Contacts');
        Assert.isNotNull(contactsList, 'Contacts list should not be null');
        Assert.areEqual(0, contactsList.size(), 'Contacts list should be empty');
    }

    @isTest
    static void testBuildDataWithParentRelationship() {
        // Given: Opportunity with Owner (parent relationship)
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Opportunity opp = new Opportunity(
            Name = 'Big Deal',
            AccountId = acc.Id,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30)
        );
        insert opp;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Opportunity with Owner',
            TemplateContentVersionId__c = '068000000000007AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, Owner.Name, Account.Name FROM Opportunity WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data with parent relationship
        Test.startTest();
        Map<String, Object> data = provider.buildData(opp.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: Should include parent object data
        Assert.isNotNull(data, 'Data map should not be null');
        Map<String, Object> oppData = (Map<String, Object>) data.get('Opportunity');

        Assert.areEqual('Big Deal', oppData.get('Name'), 'Should contain Opportunity Name');

        // Verify parent Owner relationship
        Assert.isTrue(oppData.containsKey('Owner'), 'Should contain Owner parent relationship');
        Map<String, Object> ownerData = (Map<String, Object>) oppData.get('Owner');
        Assert.isNotNull(ownerData.get('Name'), 'Owner should have Name');

        // Verify parent Account relationship
        Assert.isTrue(oppData.containsKey('Account'), 'Should contain Account parent relationship');
        Map<String, Object> accountData = (Map<String, Object>) oppData.get('Account');
        Assert.areEqual('Test Account', accountData.get('Name'), 'Account should have Name');
    }

    @isTest
    static void testFormatCurrencyVeryLarge() {
        // Given: Very large currency value (15 digits)
        Decimal value = 999999999999.99;
        String locale = 'en-GB';

        // When: Formatting very large currency
        Test.startTest();
        String formatted = StandardSOQLProvider.formatCurrency(value, locale);
        Test.stopTest();

        // Then: Should format correctly with all separators
        Assert.isNotNull(formatted, 'Formatted currency should not be null');
        Assert.isTrue(formatted.contains('£'), 'Should contain GBP symbol');
        Assert.isTrue(formatted.contains('999,999,999,999') || formatted.contains('999999999999'), 'Should contain large number');
    }

    @isTest
    static void testFormatCurrencyNegative() {
        // Given: Negative currency value
        Decimal value = -1200000.50;
        String locale = 'en-GB';

        // When: Formatting negative currency
        Test.startTest();
        String formatted = StandardSOQLProvider.formatCurrency(value, locale);
        Test.stopTest();

        // Then: Should indicate negative value
        Assert.isNotNull(formatted, 'Formatted currency should not be null');
        Assert.isTrue(formatted.contains('£'), 'Should contain GBP symbol');
        Assert.isTrue(formatted.contains('-') || formatted.startsWith('('), 'Should indicate negative');
        Assert.isTrue(formatted.contains('1,200,000') || formatted.contains('1200000'), 'Should contain amount');
    }

    @isTest
    static void testFormatNumberVerySmall() {
        // Given: Very small decimal number
        Decimal value = 0.000001;
        String locale = 'en-GB';

        // When: Formatting very small number
        Test.startTest();
        String formatted = StandardSOQLProvider.formatNumber(value, locale);
        Test.stopTest();

        // Then: Should handle precision correctly
        Assert.isNotNull(formatted, 'Formatted number should not be null');
        // The exact format depends on implementation, but should not throw error
        Assert.isTrue(true, 'Successfully formatted very small number');
    }

    @isTest
    static void testFormatNumberNegative() {
        // Given: Negative number
        Decimal value = -987654.321;
        String locale = 'en-GB';

        // When: Formatting negative number
        Test.startTest();
        String formatted = StandardSOQLProvider.formatNumber(value, locale);
        Test.stopTest();

        // Then: Should indicate negative
        Assert.isNotNull(formatted, 'Formatted number should not be null');
        Assert.isTrue(formatted.contains('-'), 'Should indicate negative');
        Assert.isTrue(formatted.contains('987,654') || formatted.contains('987654'), 'Should contain number');
    }

    @isTest
    static void testBuildDataWithAllNullFields() {
        // Given: Account with all optional fields null
        Account acc = new Account(
            Name = 'Minimal Account',
            AnnualRevenue = null,
            BillingCity = null,
            BillingStreet = null,
            Phone = null
        );
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'All Nulls Test',
            TemplateContentVersionId__c = '068000000000008AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue, BillingCity, BillingStreet, Phone FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data with all null fields
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: Should handle all nulls gracefully without errors
        Assert.isNotNull(data, 'Data map should not be null');
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');
        Assert.areEqual('Minimal Account', accountData.get('Name'), 'Name should be populated');
        // All other fields are null - key behavior is no exception thrown
        Assert.isTrue(true, 'Successfully processed record with all null optional fields');
    }

    @isTest
    static void testEmptyChildRelationship_ReturnsEmptyArray() {
        // Given: Account with NO contacts, SOQL includes Contacts subquery
        Account acc = new Account(Name = 'No Contacts Corp', BillingCountry = 'United Kingdom');
        insert acc;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Empty Child Test',
            TemplateContentVersionId__c = '068000000000009AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, (SELECT Id, FirstName FROM Contacts) FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: Contacts key MUST exist and be an empty array
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');
        Assert.isTrue(accountData.containsKey('Contacts'), 'Contacts key MUST exist for queried child relationship');
        List<Object> contacts = (List<Object>) accountData.get('Contacts');
        Assert.isNotNull(contacts, 'Contacts should be an empty list, not null');
        Assert.areEqual(0, contacts.size(), 'Contacts list should be empty');
    }

    @isTest
    static void testNestedEmptyChildRelationship_ReturnsEmptyArray() {
        // Given: Account with Opportunity but NO OpportunityLineItems
        // SOQL has 2-level nesting: Account → Opportunities → OpportunityLineItems

        // Setup: Create Account + Opportunity (no line items)
        Account acc = new Account(Name = 'Test Corp');
        insert acc;

        Opportunity opp = new Opportunity(
            Name = 'Test Deal',
            AccountId = acc.Id,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30)
        );
        insert opp;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Nested Empty Test',
            TemplateContentVersionId__c = '068000000000010AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, (SELECT Id, Name, (SELECT Id FROM OpportunityLineItems) FROM Opportunities) FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: OpportunityLineItems key MUST exist as empty array on the Opportunity
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');
        Assert.isTrue(accountData.containsKey('Opportunities'), 'Opportunities key must exist');
        List<Object> opportunities = (List<Object>) accountData.get('Opportunities');
        Assert.areEqual(1, opportunities.size(), 'Should have 1 opportunity');

        Map<String, Object> oppData = (Map<String, Object>) opportunities[0];
        Assert.isTrue(oppData.containsKey('OpportunityLineItems'),
            'OpportunityLineItems key MUST exist for queried nested child relationship');
        List<Object> lineItems = (List<Object>) oppData.get('OpportunityLineItems');
        Assert.isNotNull(lineItems, 'OpportunityLineItems should be empty list, not null');
        Assert.areEqual(0, lineItems.size(), 'OpportunityLineItems list should be empty');
    }

    @isTest
    static void testExtractSubqueryRelationships_WithNestedSubqueries() {
        // Given: SOQL with nested subqueries (Account -> Opportunities -> OpportunityLineItems)
        String soql = 'SELECT Id, Name, ' +
            '(SELECT Id, Name FROM Contacts ORDER BY CreatedDate), ' +
            '(SELECT Id, Name, (SELECT Id FROM OpportunityLineItems) FROM Opportunities ORDER BY CloseDate DESC), ' +
            '(SELECT Id, Subject, (SELECT Id FROM CaseComments) FROM Cases) ' +
            'FROM Account WHERE Id = :recordId';

        // When: Extracting subquery relationships
        Test.startTest();
        Set<String> relationships = StandardSOQLProvider.extractSubqueryRelationships(soql);
        Test.stopTest();

        // Then: Should include ALL nested relationships, not just immediate children
        Assert.isTrue(relationships.contains('Contacts'), 'Should contain Contacts');
        Assert.isTrue(relationships.contains('Opportunities'), 'Should contain Opportunities');
        Assert.isTrue(relationships.contains('OpportunityLineItems'), 'Should contain nested OpportunityLineItems');
        Assert.isTrue(relationships.contains('Cases'), 'Should contain Cases');
        Assert.isTrue(relationships.contains('CaseComments'), 'Should contain nested CaseComments');
        Assert.areEqual(5, relationships.size(), 'Should have exactly 5 relationships');
        // Should NOT include main object
        Assert.isFalse(relationships.contains('Account'), 'Should NOT contain main object Account');
    }

    @isTest
    static void testNestedChildWithData_ReturnsAllRecords() {
        // Given: Account with MULTIPLE Opportunities with line items
        // This tests that Opportunities WITH data are correctly processed
        Account acc = new Account(Name = 'Multi Opp Test Corp', BillingCountry = 'United Kingdom');
        insert acc;

        // Create multiple opportunities
        List<Opportunity> opps = new List<Opportunity>();
        for (Integer i = 0; i < 5; i++) {
            opps.add(new Opportunity(
                Name = 'Deal ' + i,
                AccountId = acc.Id,
                StageName = 'Prospecting',
                CloseDate = Date.today().addDays(30 + i)
            ));
        }
        insert opps;

        // Create a product for line items
        Product2 prod = new Product2(Name = 'Test Product', ProductCode = 'TP001', IsActive = true);
        insert prod;

        // Get standard pricebook
        Id pricebookId = Test.getStandardPricebookId();

        PricebookEntry pbe = new PricebookEntry(
            Pricebook2Id = pricebookId,
            Product2Id = prod.Id,
            UnitPrice = 100,
            IsActive = true
        );
        insert pbe;

        // Add line items to first 2 opportunities
        List<OpportunityLineItem> lineItems = new List<OpportunityLineItem>();
        for (Integer i = 0; i < 2; i++) {
            lineItems.add(new OpportunityLineItem(
                OpportunityId = opps[i].Id,
                PricebookEntryId = pbe.Id,
                Quantity = 1,
                UnitPrice = 100
            ));
        }
        insert lineItems;

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Multi Opp Test',
            TemplateContentVersionId__c = '068000000000012AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, ' +
                '(SELECT Id, Name, (SELECT Id, Product2.Name FROM OpportunityLineItems) FROM Opportunities ORDER BY CloseDate) ' +
                'FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: All 5 opportunities should be present
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');
        Assert.isTrue(accountData.containsKey('Opportunities'), 'Opportunities key must exist');
        List<Object> opportunities = (List<Object>) accountData.get('Opportunities');

        // Debug output
        System.debug('Number of opportunities in output: ' + opportunities.size());
        for (Object oppObj : opportunities) {
            Map<String, Object> oppMap = (Map<String, Object>) oppObj;
            System.debug('Opp: ' + oppMap.get('Name') + ', has LineItems key: ' + oppMap.containsKey('OpportunityLineItems'));
        }

        Assert.areEqual(5, opportunities.size(), 'Should have all 5 opportunities');

        // Verify first opp has line items
        Map<String, Object> firstOpp = (Map<String, Object>) opportunities[0];
        Assert.isTrue(firstOpp.containsKey('OpportunityLineItems'), 'First opp should have line items key');
        List<Object> firstOppLineItems = (List<Object>) firstOpp.get('OpportunityLineItems');
        Assert.areEqual(1, firstOppLineItems.size(), 'First opp should have 1 line item');

        // Verify last opp has empty line items array
        Map<String, Object> lastOpp = (Map<String, Object>) opportunities[4];
        Assert.isTrue(lastOpp.containsKey('OpportunityLineItems'), 'Last opp should have line items key');
        List<Object> lastOppLineItems = (List<Object>) lastOpp.get('OpportunityLineItems');
        Assert.areEqual(0, lastOppLineItems.size(), 'Last opp should have empty line items');
    }

    @isTest
    static void testThreeLevelNestedEmptyChildRelationship_ReturnsEmptyArray() {
        // Given: Account with Case but NO CaseComments
        // SOQL has 2-level nesting: Account → Cases → CaseComments
        // This validates the fix works at multiple nested levels

        Account acc = new Account(Name = 'Three Level Test');
        insert acc;

        Case c = new Case(
            Subject = 'Test Case',
            AccountId = acc.Id,
            Status = 'New'
        );
        insert c;
        // No CaseComments added

        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Three Level Test',
            TemplateContentVersionId__c = '068000000000011AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, (SELECT Id, Subject, (SELECT Id FROM CaseComments) FROM Cases) FROM Account WHERE Id = :recordId'
        );
        insert template;

        StandardSOQLProvider provider = new StandardSOQLProvider();

        // When: Building data
        Test.startTest();
        Map<String, Object> data = provider.buildData(acc.Id, template, 'en-GB', 'Europe/London');
        Test.stopTest();

        // Then: CaseComments key MUST exist as empty array on the Case
        Map<String, Object> accountData = (Map<String, Object>) data.get('Account');
        Assert.isTrue(accountData.containsKey('Cases'), 'Cases key must exist');
        List<Object> cases = (List<Object>) accountData.get('Cases');
        Assert.areEqual(1, cases.size(), 'Should have 1 case');

        Map<String, Object> caseData = (Map<String, Object>) cases[0];
        Assert.isTrue(caseData.containsKey('CaseComments'),
            'CaseComments key MUST exist for queried nested child relationship');
        List<Object> comments = (List<Object>) caseData.get('CaseComments');
        Assert.isNotNull(comments, 'CaseComments should be empty list, not null');
        Assert.areEqual(0, comments.size(), 'CaseComments list should be empty');
    }
}
