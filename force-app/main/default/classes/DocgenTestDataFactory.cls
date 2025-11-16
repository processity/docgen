/**
 * Test data factory for creating test scenarios across multiple object types.
 * Provides centralized test data creation and reduces duplication across test classes.
 *
 * Usage:
 *   TestScenario scenario = DocgenTestDataFactory.createScenarioForObject('Contact');
 *   // scenario.record contains inserted Contact
 *   // scenario.template contains configured Docgen_Template__c
 *   // scenario.lookupFieldName is 'Contact__c'
 */
@IsTest
public class DocgenTestDataFactory {

    /**
     * Container for test scenario data
     */
    public class TestScenario {
        public SObject record { get; set; }
        public String objectApiName { get; set; }
        public String lookupFieldName { get; set; }
        public Docgen_Template__c template { get; set; }
        public Id recordId { get; set; }

        public TestScenario() {
            // Default constructor
        }
    }

    /**
     * Container for bulk test scenario data
     */
    public class BulkTestScenario {
        public List<SObject> records { get; set; }
        public String objectApiName { get; set; }
        public String lookupFieldName { get; set; }
        public Docgen_Template__c template { get; set; }
        public List<Id> recordIds { get; set; }

        public BulkTestScenario() {
            this.records = new List<SObject>();
            this.recordIds = new List<Id>();
        }
    }

    /**
     * Create a complete test scenario for a given object type.
     * Includes: test record, template, and configuration metadata.
     *
     * @param objectApiName - API name like 'Account', 'Contact', 'Lead'
     * @return TestScenario with all necessary test data
     */
    public static TestScenario createScenarioForObject(String objectApiName) {
        TestScenario scenario = new TestScenario();
        scenario.objectApiName = objectApiName;

        // Create test record based on object type
        scenario.record = createTestRecord(objectApiName);
        insert scenario.record;
        scenario.recordId = scenario.record.Id;

        // Get configuration to find lookup field name
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject(objectApiName);
        scenario.lookupFieldName = config.Lookup_Field_API_Name__c;

        // Create template for this object type
        scenario.template = createTemplateForObject(objectApiName);

        return scenario;
    }

    /**
     * Create bulk test scenario with multiple records of same type
     *
     * @param objectApiName - API name like 'Account', 'Contact'
     * @param recordCount - Number of records to create (default 200)
     * @return BulkTestScenario with list of records and template
     */
    public static BulkTestScenario createBulkScenarioForObject(String objectApiName, Integer recordCount) {
        BulkTestScenario scenario = new BulkTestScenario();
        scenario.objectApiName = objectApiName;

        // Create multiple test records
        for (Integer i = 0; i < recordCount; i++) {
            SObject record = createTestRecord(objectApiName, i);
            scenario.records.add(record);
        }

        insert scenario.records;

        // Extract IDs
        for (SObject record : scenario.records) {
            scenario.recordIds.add(record.Id);
        }

        // Get configuration
        Supported_Object__mdt config = DocgenObjectConfigService.getConfigForObject(objectApiName);
        scenario.lookupFieldName = config.Lookup_Field_API_Name__c;

        // Create template
        scenario.template = createTemplateForObject(objectApiName);

        return scenario;
    }

    /**
     * Create a test record for the specified object type
     *
     * @param objectApiName - Object API name
     * @return SObject test record (not inserted)
     */
    private static SObject createTestRecord(String objectApiName) {
        return createTestRecord(objectApiName, 0);
    }

    /**
     * Create a test record with unique values based on index
     *
     * @param objectApiName - Object API name
     * @param index - Index for unique naming
     * @return SObject test record (not inserted)
     */
    private static SObject createTestRecord(String objectApiName, Integer index) {
        String suffix = index > 0 ? ' ' + index : '';

        if (objectApiName == 'Account') {
            return new Account(
                Name = 'Test Account' + suffix,
                BillingCity = 'San Francisco',
                AnnualRevenue = 1000000
            );
        } else if (objectApiName == 'Contact') {
            return new Contact(
                FirstName = 'Test',
                LastName = 'Contact' + suffix,
                Email = 'test' + index + '@example.com'
            );
        } else if (objectApiName == 'Lead') {
            return new Lead(
                FirstName = 'Test',
                LastName = 'Lead' + suffix,
                Company = 'Test Company' + suffix,
                Email = 'testlead' + index + '@example.com',
                Status = 'Open - Not Contacted'
            );
        } else if (objectApiName == 'Opportunity') {
            // Need an Account for Opportunity
            Account acc = new Account(Name = 'Test Account for Opp' + suffix);
            insert acc;

            return new Opportunity(
                Name = 'Test Opportunity' + suffix,
                StageName = 'Prospecting',
                CloseDate = Date.today().addDays(30),
                AccountId = acc.Id,
                Amount = 50000
            );
        } else if (objectApiName == 'Case') {
            // Optionally link to Account
            Account acc = new Account(Name = 'Test Account for Case' + suffix);
            insert acc;

            return new Case(
                Subject = 'Test Case' + suffix,
                Status = 'New',
                Origin = 'Web',
                AccountId = acc.Id
            );
        }

        throw new UnsupportedObjectException('Object type not supported: ' + objectApiName);
    }

    /**
     * Create a template configured for the specified object type
     *
     * @param objectApiName - Object API name
     * @return Docgen_Template__c (inserted)
     */
    private static Docgen_Template__c createTemplateForObject(String objectApiName) {
        String soql = buildSOQLForObject(objectApiName);

        Docgen_Template__c template = new Docgen_Template__c(
            Name = objectApiName + ' Test Template',
            PrimaryParent__c = objectApiName,
            DataSource__c = 'SOQL',
            SOQL__c = soql,
            TemplateContentVersionId__c = '068000000000000AAA', // Mock ContentVersionId
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true
        );

        insert template;
        return template;
    }

    /**
     * Build appropriate SOQL query for object type
     *
     * @param objectApiName - Object API name
     * @return SOQL query string with :recordId binding
     */
    private static String buildSOQLForObject(String objectApiName) {
        if (objectApiName == 'Account') {
            return 'SELECT Id, Name, BillingCity, AnnualRevenue FROM Account WHERE Id = :recordId';
        } else if (objectApiName == 'Contact') {
            return 'SELECT Id, FirstName, LastName, Email, AccountId FROM Contact WHERE Id = :recordId';
        } else if (objectApiName == 'Lead') {
            return 'SELECT Id, FirstName, LastName, Company, Email, Status FROM Lead WHERE Id = :recordId';
        } else if (objectApiName == 'Opportunity') {
            return 'SELECT Id, Name, StageName, CloseDate, Amount, AccountId, Account.Name FROM Opportunity WHERE Id = :recordId';
        } else if (objectApiName == 'Case') {
            return 'SELECT Id, Subject, Status, Origin, AccountId, Account.Name FROM Case WHERE Id = :recordId';
        }

        throw new UnsupportedObjectException('Object type not supported: ' + objectApiName);
    }

    /**
     * Create mixed-object scenario with multiple object types
     * Useful for testing batch operations across different objects
     *
     * @param objectCounts - Map of objectApiName to count (e.g., {'Account' => 100, 'Contact' => 100})
     * @return Map of objectApiName to BulkTestScenario
     */
    public static Map<String, BulkTestScenario> createMixedObjectScenario(Map<String, Integer> objectCounts) {
        Map<String, BulkTestScenario> scenarios = new Map<String, BulkTestScenario>();

        for (String objectApiName : objectCounts.keySet()) {
            Integer count = objectCounts.get(objectApiName);
            BulkTestScenario scenario = createBulkScenarioForObject(objectApiName, count);
            scenarios.put(objectApiName, scenario);
        }

        return scenarios;
    }

    /**
     * Custom exception for unsupported object types
     */
    public class UnsupportedObjectException extends Exception {}
}
