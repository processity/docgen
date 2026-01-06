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

    // =========================================================================
    // PUBLIC OBJECT CREATION METHODS
    // Use these methods for centralized test data creation
    // =========================================================================

    /**
     * Create and insert a test Account
     * @return Account (inserted)
     */
    public static Account createAccount() {
        return createAccount('Test Account');
    }

    /**
     * Create and insert a test Account with specified name
     * @param name - Account name
     * @return Account (inserted)
     */
    public static Account createAccount(String name) {
        Account acc = new Account(
            Name = name,
            BillingCity = 'San Francisco',
            AnnualRevenue = 1000000
        );
        insert acc;
        return acc;
    }

    /**
     * Create and insert multiple test Accounts
     * @param count - Number of accounts to create
     * @return List<Account> (inserted)
     */
    public static List<Account> createAccounts(Integer count) {
        List<Account> accounts = new List<Account>();
        for (Integer i = 1; i <= count; i++) {
            accounts.add(new Account(
                Name = 'Test Account ' + i,
                BillingCity = 'San Francisco',
                AnnualRevenue = 100000 * i
            ));
        }
        insert accounts;
        return accounts;
    }

    /**
     * Create and insert a test Contact (without Account)
     * @return Contact (inserted)
     */
    public static Contact createContact() {
        return createContact('Test', 'Contact', null);
    }

    /**
     * Create and insert a test Contact linked to Account
     * @param accountId - Parent Account Id
     * @return Contact (inserted)
     */
    public static Contact createContact(Id accountId) {
        return createContact('Test', 'Contact', accountId);
    }

    /**
     * Create and insert a test Contact with specified details
     * @param firstName - Contact first name
     * @param lastName - Contact last name
     * @param accountId - Parent Account Id (optional)
     * @return Contact (inserted)
     */
    public static Contact createContact(String firstName, String lastName, Id accountId) {
        Contact con = new Contact(
            FirstName = firstName,
            LastName = lastName,
            Email = firstName.toLowerCase() + '.' + lastName.toLowerCase() + '@example.com',
            AccountId = accountId
        );
        insert con;
        return con;
    }

    /**
     * Create and insert multiple test Contacts
     * @param count - Number of contacts to create
     * @param accountId - Parent Account Id (optional)
     * @return List<Contact> (inserted)
     */
    public static List<Contact> createContacts(Integer count, Id accountId) {
        List<Contact> contacts = new List<Contact>();
        for (Integer i = 1; i <= count; i++) {
            contacts.add(new Contact(
                FirstName = 'Test',
                LastName = 'Contact ' + i,
                Email = 'test.contact' + i + '@example.com',
                AccountId = accountId
            ));
        }
        insert contacts;
        return contacts;
    }

    /**
     * Create and insert a test Lead
     * @return Lead (inserted)
     */
    public static Lead createLead() {
        return createLead('Test', 'Lead', 'Test Company');
    }

    /**
     * Create and insert a test Lead with specified details
     * @param firstName - Lead first name
     * @param lastName - Lead last name
     * @param company - Lead company
     * @return Lead (inserted)
     */
    public static Lead createLead(String firstName, String lastName, String company) {
        Lead ld = new Lead(
            FirstName = firstName,
            LastName = lastName,
            Company = company,
            Email = firstName.toLowerCase() + '.' + lastName.toLowerCase() + '@example.com',
            Status = 'Open - Not Contacted'
        );
        insert ld;
        return ld;
    }

    /**
     * Create and insert multiple test Leads
     * @param count - Number of leads to create
     * @return List<Lead> (inserted)
     */
    public static List<Lead> createLeads(Integer count) {
        List<Lead> leads = new List<Lead>();
        for (Integer i = 1; i <= count; i++) {
            leads.add(new Lead(
                FirstName = 'Test',
                LastName = 'Lead ' + i,
                Company = 'Test Company ' + i,
                Email = 'test.lead' + i + '@example.com',
                Status = 'Open - Not Contacted'
            ));
        }
        insert leads;
        return leads;
    }

    /**
     * Create and insert a test Opportunity (creates Account automatically)
     * @return Opportunity (inserted)
     */
    public static Opportunity createOpportunity() {
        Account acc = createAccount('Account for Opportunity');
        return createOpportunity('Test Opportunity', acc.Id);
    }

    /**
     * Create and insert a test Opportunity linked to Account
     * @param accountId - Parent Account Id
     * @return Opportunity (inserted)
     */
    public static Opportunity createOpportunity(Id accountId) {
        return createOpportunity('Test Opportunity', accountId);
    }

    /**
     * Create and insert a test Opportunity with specified details
     * @param name - Opportunity name
     * @param accountId - Parent Account Id
     * @return Opportunity (inserted)
     */
    public static Opportunity createOpportunity(String name, Id accountId) {
        Opportunity opp = new Opportunity(
            Name = name,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30),
            AccountId = accountId,
            Amount = 50000
        );
        insert opp;
        return opp;
    }

    /**
     * Create and insert multiple test Opportunities
     * @param count - Number of opportunities to create
     * @param accountId - Parent Account Id
     * @return List<Opportunity> (inserted)
     */
    public static List<Opportunity> createOpportunities(Integer count, Id accountId) {
        List<Opportunity> opps = new List<Opportunity>();
        for (Integer i = 1; i <= count; i++) {
            opps.add(new Opportunity(
                Name = 'Test Opportunity ' + i,
                StageName = 'Prospecting',
                CloseDate = Date.today().addDays(30),
                AccountId = accountId,
                Amount = 50000 * i
            ));
        }
        insert opps;
        return opps;
    }

    /**
     * Create and insert a test Case (creates Account automatically)
     * @return Case (inserted)
     */
    public static Case createCase() {
        Account acc = createAccount('Account for Case');
        return createCase('Test Case', acc.Id);
    }

    /**
     * Create and insert a test Case linked to Account
     * @param accountId - Parent Account Id
     * @return Case (inserted)
     */
    public static Case createCase(Id accountId) {
        return createCase('Test Case', accountId);
    }

    /**
     * Create and insert a test Case with specified details
     * @param subject - Case subject
     * @param accountId - Parent Account Id
     * @return Case (inserted)
     */
    public static Case createCase(String subject, Id accountId) {
        Case cs = new Case(
            Subject = subject,
            Status = 'New',
            Origin = 'Web',
            AccountId = accountId
        );
        insert cs;
        return cs;
    }

    /**
     * Create and insert multiple test Cases
     * @param count - Number of cases to create
     * @param accountId - Parent Account Id
     * @return List<Case> (inserted)
     */
    public static List<Case> createCases(Integer count, Id accountId) {
        List<Case> cases = new List<Case>();
        for (Integer i = 1; i <= count; i++) {
            cases.add(new Case(
                Subject = 'Test Case ' + i,
                Status = 'New',
                Origin = 'Web',
                AccountId = accountId
            ));
        }
        insert cases;
        return cases;
    }

    // =========================================================================
    // TEMPLATE CREATION METHODS
    // =========================================================================

    /**
     * Create and insert a Docgen_Template__c for SOQL data source
     * @param name - Template name
     * @param primaryParent - Primary object type (Account, Contact, etc.)
     * @param soql - SOQL query
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createTemplate(String name, String primaryParent, String soql) {
        Docgen_Template__c template = new Docgen_Template__c(
            Name = name,
            PrimaryParent__c = primaryParent,
            DataSource__c = 'SOQL',
            SOQL__c = soql,
            TemplateContentVersionId__c = '068000000000000AAA',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true
        );
        insert template;
        return template;
    }

    /**
     * Create and insert a Docgen_Template__c for Custom data source
     * @param name - Template name
     * @param primaryParent - Primary object type
     * @param className - Custom provider class name
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createCustomTemplate(String name, String primaryParent, String className) {
        Docgen_Template__c template = new Docgen_Template__c(
            Name = name,
            PrimaryParent__c = primaryParent,
            DataSource__c = 'Custom',
            ClassName__c = className,
            TemplateContentVersionId__c = '068000000000000AAA',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = true
        );
        insert template;
        return template;
    }

    /**
     * Create and insert a Docgen_Template__c with full configuration
     * @param name - Template name
     * @param primaryParent - Primary object type
     * @param dataSource - 'SOQL' or 'Custom'
     * @param soql - SOQL query (for SOQL data source)
     * @param className - Custom provider class name (for Custom data source)
     * @param templateContentVersionId - ContentVersion ID for template file
     * @param storeMergedDocx - Whether to store merged DOCX
     * @param returnDocxToBrowser - Whether to return DOCX to browser
     * @param returnMultipleRecords - Whether template returns multiple records
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createTemplateWithConfig(
        String name,
        String primaryParent,
        String dataSource,
        String soql,
        String className,
        String templateContentVersionId,
        Boolean storeMergedDocx,
        Boolean returnDocxToBrowser,
        Boolean returnMultipleRecords
    ) {
        Docgen_Template__c template = new Docgen_Template__c(
            Name = name,
            PrimaryParent__c = primaryParent,
            DataSource__c = dataSource,
            SOQL__c = soql,
            ClassName__c = className,
            TemplateContentVersionId__c = templateContentVersionId,
            StoreMergedDocx__c = storeMergedDocx,
            ReturnDocxToBrowser__c = returnDocxToBrowser,
            ReturnMultipleRecords__c = returnMultipleRecords
        );
        insert template;
        return template;
    }

    /**
     * Create a default Account template
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createAccountTemplate() {
        return createTemplate(
            'Account Test Template',
            'Account',
            'SELECT Id, Name, BillingCity, AnnualRevenue FROM Account WHERE Id = :recordId'
        );
    }

    /**
     * Create a default Contact template
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createContactTemplate() {
        return createTemplate(
            'Contact Test Template',
            'Contact',
            'SELECT Id, FirstName, LastName, Email, AccountId FROM Contact WHERE Id = :recordId'
        );
    }

    /**
     * Create a default Lead template
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createLeadTemplate() {
        return createTemplate(
            'Lead Test Template',
            'Lead',
            'SELECT Id, FirstName, LastName, Company, Email, Status FROM Lead WHERE Id = :recordId'
        );
    }

    /**
     * Create a default Opportunity template
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createOpportunityTemplate() {
        return createTemplate(
            'Opportunity Test Template',
            'Opportunity',
            'SELECT Id, Name, StageName, CloseDate, Amount, AccountId FROM Opportunity WHERE Id = :recordId'
        );
    }

    /**
     * Create a default Case template
     * @return Docgen_Template__c (inserted)
     */
    public static Docgen_Template__c createCaseTemplate() {
        return createTemplate(
            'Case Test Template',
            'Case',
            'SELECT Id, Subject, Status, Origin, AccountId FROM Case WHERE Id = :recordId'
        );
    }

    // =========================================================================
    // GENERATED DOCUMENT CREATION METHODS
    // =========================================================================

    /**
     * Create and insert a Generated_Document__c record
     * @param templateId - Template ID
     * @param accountId - Account lookup (optional)
     * @param status - Document status
     * @return Generated_Document__c (inserted)
     */
    public static Generated_Document__c createGeneratedDocument(
        Id templateId,
        Id accountId,
        String status
    ) {
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            Account__c = accountId,
            Status__c = status,
            OutputFormat__c = 'PDF',
            RequestHash__c = 'hash-' + System.currentTimeMillis() + '-' + Math.random(),
            CorrelationId__c = 'corr-' + System.currentTimeMillis()
        );
        insert doc;
        return doc;
    }

    /**
     * Create and insert a Generated_Document__c with full configuration
     * @param templateId - Template ID
     * @param compositeDocId - Composite Document ID (optional)
     * @param accountId - Account lookup (optional)
     * @param contactId - Contact lookup (optional)
     * @param leadId - Lead lookup (optional)
     * @param opportunityId - Opportunity lookup (optional)
     * @param caseId - Case lookup (optional)
     * @param status - Document status
     * @param outputFormat - Output format (PDF, DOCX)
     * @return Generated_Document__c (inserted)
     */
    public static Generated_Document__c createGeneratedDocumentWithConfig(
        Id templateId,
        Id compositeDocId,
        Id accountId,
        Id contactId,
        Id leadId,
        Id opportunityId,
        Id caseId,
        String status,
        String outputFormat
    ) {
        Generated_Document__c doc = new Generated_Document__c(
            Template__c = templateId,
            Composite_Document__c = compositeDocId,
            Account__c = accountId,
            Contact__c = contactId,
            Lead__c = leadId,
            Opportunity__c = opportunityId,
            Case__c = caseId,
            Status__c = status,
            OutputFormat__c = outputFormat,
            RequestHash__c = 'hash-' + System.currentTimeMillis() + '-' + Math.random(),
            CorrelationId__c = 'corr-' + System.currentTimeMillis()
        );
        insert doc;
        return doc;
    }

    // =========================================================================
    // PRIVATE HELPER METHODS (for internal use by scenario builders)
    // =========================================================================

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
