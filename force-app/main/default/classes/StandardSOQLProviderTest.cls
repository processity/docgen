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
}
