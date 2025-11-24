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
     * Container for composite document test scenario
     */
    public class CompositeScenario {
        public Composite_Document__c compositeDoc { get; set; }
        public List<Docgen_Template__c> templates { get; set; }
        public List<Composite_Document_Template__c> junctions { get; set; }
        public SObject testRecord { get; set; }
        public Id testRecordId { get; set; }
        public String objectApiName { get; set; }

        public CompositeScenario() {
            this.templates = new List<Docgen_Template__c>();
            this.junctions = new List<Composite_Document_Template__c>();
        }
    }

    /**
     * Create a Composite_Document__c record for testing
     *
     * @param templateStrategy - 'Own Template' or 'Concatenate Templates'
     * @param templateContentVersionId - Required if strategy is 'Own Template'
     * @param primaryParent - Primary object type (e.g., 'Account', 'Contact')
     * @return Composite_Document__c (inserted)
     */
    public static Composite_Document__c createCompositeDocument(
        String templateStrategy,
        String templateContentVersionId,
        String primaryParent
    ) {
        Composite_Document__c composite = new Composite_Document__c(
            Description__c = 'Test composite document for automated testing',
            Template_Strategy__c = templateStrategy,
            TemplateContentVersionId__c = templateContentVersionId,
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true,
            PrimaryParent__c = primaryParent,
            IsActive__c = true
        );

        insert composite;
        return composite;
    }

    /**
     * Create a Composite_Document_Template__c junction record
     *
     * @param compositeDocId - Composite_Document__c ID
     * @param templateId - Docgen_Template__c ID
     * @param namespace - Namespace key for data (e.g., 'Account', 'Terms')
     * @param sequence - Execution order
     * @return Composite_Document_Template__c (inserted)
     */
    public static Composite_Document_Template__c createCompositeDocumentTemplate(
        Id compositeDocId,
        Id templateId,
        String namespace,
        Integer sequence
    ) {
        Composite_Document_Template__c junction = new Composite_Document_Template__c(
            Composite_Document__c = compositeDocId,
            Document_Template__c = templateId,
            Namespace__c = namespace,
            Sequence__c = sequence,
            IsActive__c = true
        );

        insert junction;
        return junction;
    }

    /**
     * Create a complete composite document test scenario with templates and junctions
     *
     * @param objectApiName - Primary object type (e.g., 'Account')
     * @param templateCount - Number of templates/namespaces (default 2)
     * @param templateStrategy - 'Own Template' or 'Concatenate Templates'
     * @return CompositeScenario with all test data
     */
    public static CompositeScenario createCompositeScenario(
        String objectApiName,
        Integer templateCount,
        String templateStrategy
    ) {
        CompositeScenario scenario = new CompositeScenario();
        scenario.objectApiName = objectApiName;

        // Create test record
        scenario.testRecord = createTestRecord(objectApiName);
        insert scenario.testRecord;
        scenario.testRecordId = scenario.testRecord.Id;

        // Create composite document
        String templateContentVersionId = null;
        if (templateStrategy == 'Own Template') {
            templateContentVersionId = '068000000000001AAA'; // Mock ContentVersionId for composite template
        }

        scenario.compositeDoc = createCompositeDocument(
            templateStrategy,
            templateContentVersionId,
            objectApiName
        );

        // Create templates and junction records
        for (Integer i = 0; i < templateCount; i++) {
            // Create template
            String namespace = (i == 0) ? objectApiName : ('Section' + i);
            String soql = (i == 0) ? buildSOQLForObject(objectApiName) : 'SELECT Id FROM ' + objectApiName + ' WHERE Id = :recordId';

            Docgen_Template__c template = new Docgen_Template__c(
                Name = namespace + ' Template',
                PrimaryParent__c = objectApiName,
                DataSource__c = 'SOQL',
                SOQL__c = soql,
                TemplateContentVersionId__c = '068' + String.valueOf(i).leftPad(12, '0') + 'AAA',
                StoreMergedDocx__c = false,
                ReturnDocxToBrowser__c = true
            );
            insert template;
            scenario.templates.add(template);

            // Create junction record
            Composite_Document_Template__c junction = createCompositeDocumentTemplate(
                scenario.compositeDoc.Id,
                template.Id,
                namespace,
                (i + 1) * 10  // Sequence: 10, 20, 30, etc.
            );
            scenario.junctions.add(junction);
        }

        return scenario;
    }

    /**
     * Custom exception for unsupported object types
     */
    public class UnsupportedObjectException extends Exception {}
}
