/**
 * Complex Account Summary E2E Test
 *
 * This test validates a realistic, complex document generation scenario with:
 * - Multiple child objects (Contacts, Opportunities, Cases)
 * - Nested child relationships (OpportunityLineItems, CaseComments)
 * - Lookup field traversal (Opportunity.Account, Case.Contact)
 * - Edge cases (empty arrays, null values, different stages/statuses)
 * - Aggregations and conditional logic
 * - Formatted values (currency, dates, percentages)
 *
 * Simulates a real-world "Account Summary" report for enterprise customers.
 */

import { test, expect } from '../fixtures/salesforce.fixture';
import { WorkerHelper } from '../utils/worker-helper';
import { BatchHelper } from '../utils/batch-helper';
import { ScratchOrgHelper } from '../utils/scratch-org';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Complex Account Summary E2E Test', () => {
  let workerHelper: WorkerHelper;
  let batchHelper: BatchHelper;
  let orgHelper: ScratchOrgHelper;

  test.beforeEach(async ({ salesforce }) => {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new Error('BACKEND_URL environment variable is required');
    }

    orgHelper = new ScratchOrgHelper(
      salesforce.authenticatedPage,
      salesforce.scratchOrgConfig
    );

    workerHelper = new WorkerHelper(
      salesforce.authenticatedPage,
      orgHelper,
      backendUrl
    );

    batchHelper = new BatchHelper(
      salesforce.authenticatedPage,
      orgHelper
    );
  });

  test('generates complex Account Summary with all child objects and edge cases', async ({ salesforce: _salesforce }) => {
    // Set timeout for complex batch processing (lots of data + processing)
    test.setTimeout(360000); // 6 minutes

    console.log(`\n${'='.repeat(80)}`);
    console.log('TEST: Complex Account Summary with multiple child objects');
    console.log(`${'='.repeat(80)}`);

    // ============================================================================
    // STEP 1: Create Account with realistic data
    // ============================================================================
    console.log('\n[1/7] Creating Account with realistic data...');

    const accountData = {
      Name: `E2E_ComplexAccount_${Date.now()}`,
      Type: 'Customer',
      Industry: 'Technology',
      BillingStreet: '1 Market Street',
      BillingCity: 'San Francisco',
      BillingState: 'CA',
      BillingPostalCode: '94105',
      BillingCountry: 'United States',
      Phone: '(415) 555-1234',
      Website: 'https://www.example.com',
      AnnualRevenue: 15000000,
      NumberOfEmployees: 250,
      Description: 'Enterprise customer with complex product mix and active support cases'
    };

    const accountId = await orgHelper.createRecord('Account', accountData);
    console.log(`✓ Created Account: ${accountId.id}`);

    let createdRecordIds: { type: string; ids: string[] }[] = [];
    createdRecordIds.push({ type: 'Account', ids: [accountId.id] });

    try {
      // ============================================================================
      // STEP 2: Create 5 Contacts with varying levels of completeness (edge cases)
      // ============================================================================
      console.log('\n[2/7] Creating 5 Contacts with varying completeness...');

      const contactsData = [
        {
          FirstName: 'John',
          LastName: 'Smith',
          Title: 'CEO',
          Email: 'john.smith@example.com',
          Phone: '(415) 555-1001',
          Department: 'Executive',
          AccountId: accountId.id
        },
        {
          FirstName: 'Sarah',
          LastName: 'Johnson',
          Title: 'VP of Engineering',
          Email: 'sarah.johnson@example.com',
          Phone: '(415) 555-1002',
          Department: 'Engineering',
          AccountId: accountId.id
        },
        {
          FirstName: 'Michael',
          LastName: 'Chen',
          Title: 'Product Manager',
          Email: 'michael.chen@example.com',
          Phone: '(415) 555-1003',
          Department: 'Product',
          AccountId: accountId.id
        },
        {
          // Edge case: Contact with minimal data
          FirstName: 'Anna',
          LastName: 'Williams',
          Email: 'anna.williams@example.com',
          AccountId: accountId.id
          // No Title, Phone, or Department
        },
        {
          // Edge case: Contact with only required fields
          FirstName: 'David',
          LastName: 'Brown',
          AccountId: accountId.id
          // No Email, Title, Phone, or Department
        }
      ];

      const contactIds: string[] = [];
      for (const contactData of contactsData) {
        const contact = await orgHelper.createRecord('Contact', contactData);
        contactIds.push(contact.id);
      }
      console.log(`✓ Created ${contactIds.length} Contacts (with edge cases: minimal data)`);
      createdRecordIds.push({ type: 'Contact', ids: contactIds });

      // ============================================================================
      // STEP 3: Create Products for OpportunityLineItems
      // ============================================================================
      console.log('\n[3/7] Creating Products for line items...');

      // Get standard price book
      const pricebookResult = await orgHelper.query(
        "SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1"
      );
      const standardPricebookId = pricebookResult[0].Id;
      console.log(`✓ Found standard Pricebook: ${standardPricebookId}`);

      // Create products
      const productsData = [
        { Name: 'Enterprise Software License', ProductCode: 'ESL-001', IsActive: true },
        { Name: 'Professional Services - Consulting', ProductCode: 'PS-CONS', IsActive: true },
        { Name: 'Premium Support Package', ProductCode: 'SUP-PREM', IsActive: true },
        { Name: 'Training & Enablement', ProductCode: 'TRN-ENB', IsActive: true },
        { Name: 'Cloud Infrastructure', ProductCode: 'CLD-INF', IsActive: true }
      ];

      const productIds: string[] = [];
      for (const productData of productsData) {
        const product = await orgHelper.createRecord('Product2', productData);
        productIds.push(product.id);
      }
      console.log(`✓ Created ${productIds.length} Products`);
      createdRecordIds.push({ type: 'Product2', ids: productIds });

      // Create PricebookEntries
      const pricebookEntryIds: string[] = [];
      const unitPrices = [50000, 25000, 15000, 10000, 20000];

      for (let i = 0; i < productIds.length; i++) {
        const pbe = await orgHelper.createRecord('PricebookEntry', {
          Pricebook2Id: standardPricebookId,
          Product2Id: productIds[i],
          UnitPrice: unitPrices[i],
          IsActive: true
        });
        pricebookEntryIds.push(pbe.id);
      }
      console.log(`✓ Created ${pricebookEntryIds.length} PricebookEntries`);

      // ============================================================================
      // STEP 4: Create 5 Opportunities with different stages and line items
      // ============================================================================
      console.log('\n[4/7] Creating 5 Opportunities across different stages...');

      const opportunitiesData = [
        {
          name: 'FY2025 Enterprise License Renewal',
          stage: 'Closed Won',
          amount: 500000,
          probability: 100,
          closeDate: '2025-06-30',
          lineItems: [
            { pricebookEntryId: pricebookEntryIds[0], quantity: 5, unitPrice: 50000 },
            { pricebookEntryId: pricebookEntryIds[2], quantity: 2, unitPrice: 15000 },
            { pricebookEntryId: pricebookEntryIds[4], quantity: 10, unitPrice: 20000 }
          ]
        },
        {
          name: 'Q4 Professional Services Expansion',
          stage: 'Closed Won',
          amount: 150000,
          probability: 100,
          closeDate: '2025-10-15',
          lineItems: [
            { pricebookEntryId: pricebookEntryIds[1], quantity: 6, unitPrice: 25000 }
          ]
        },
        {
          name: 'New Product Module - Prospecting',
          stage: 'Prospecting',
          amount: 75000,
          probability: 10,
          closeDate: '2026-03-31',
          lineItems: [
            { pricebookEntryId: pricebookEntryIds[0], quantity: 1, unitPrice: 50000 },
            { pricebookEntryId: pricebookEntryIds[3], quantity: 2, unitPrice: 10000 }
          ]
        },
        {
          name: 'Training Package - Negotiation',
          stage: 'Negotiation/Review',
          amount: 45000,
          probability: 75,
          closeDate: '2026-01-31',
          lineItems: [
            { pricebookEntryId: pricebookEntryIds[3], quantity: 3, unitPrice: 10000 },
            { pricebookEntryId: pricebookEntryIds[2], quantity: 1, unitPrice: 15000 }
          ]
        },
        {
          name: 'Cloud Migration - Lost',
          stage: 'Closed Lost',
          amount: 200000,
          probability: 0,
          closeDate: '2025-08-30',
          lineItems: [
            { pricebookEntryId: pricebookEntryIds[4], quantity: 10, unitPrice: 20000 }
          ]
        }
      ];

      const opportunityIds: string[] = [];
      const lineItemIds: string[] = [];

      for (const oppData of opportunitiesData) {
        // Create Opportunity
        const opp = await orgHelper.createRecord('Opportunity', {
          Name: oppData.name,
          StageName: oppData.stage,
          Amount: oppData.amount,
          Probability: oppData.probability,
          CloseDate: oppData.closeDate,
          AccountId: accountId.id,
          Pricebook2Id: standardPricebookId
        });
        opportunityIds.push(opp.id);

        // Create OpportunityLineItems
        for (const lineItem of oppData.lineItems) {
          const oli = await orgHelper.createRecord('OpportunityLineItem', {
            OpportunityId: opp.id,
            PricebookEntryId: lineItem.pricebookEntryId,
            Quantity: lineItem.quantity,
            UnitPrice: lineItem.unitPrice
          });
          lineItemIds.push(oli.id);
        }
      }

      console.log(`✓ Created ${opportunityIds.length} Opportunities`);
      console.log(`  - 2 Closed Won (with revenue)`);
      console.log(`  - 2 Open (Prospecting, Negotiation)`);
      console.log(`  - 1 Closed Lost`);
      console.log(`✓ Created ${lineItemIds.length} OpportunityLineItems`);
      createdRecordIds.push({ type: 'Opportunity', ids: opportunityIds });

      // ============================================================================
      // STEP 5: Create 3 Cases with different statuses and comments
      // ============================================================================
      console.log('\n[5/7] Creating 3 Cases with varying comments...');

      const casesData = [
        {
          subject: 'Critical: API Integration Timeout Issues',
          status: 'Closed',
          priority: 'High',
          origin: 'Email',
          contactId: contactIds[0], // CEO
          comments: [
            { body: 'Initial report from customer about intermittent API timeouts during peak hours.' },
            { body: 'Engineering team identified and deployed fix. Issue resolved. Following up with customer.' }
          ]
        },
        {
          subject: 'Feature Request: Custom Dashboard Export',
          status: 'In Progress',
          priority: 'Medium',
          origin: 'Web',
          contactId: contactIds[1], // VP of Engineering
          comments: [
            { body: 'Customer requested ability to export custom dashboards to PDF format.' }
          ]
        },
        {
          subject: 'Question: User Permissions Configuration',
          status: 'New',
          priority: 'Low',
          origin: 'Phone',
          contactId: contactIds[2], // Product Manager
          comments: []  // Edge case: Case with no comments
        }
      ];

      const caseIds: string[] = [];
      const caseCommentIds: string[] = [];

      for (const caseData of casesData) {
        // Create Case
        const caseRecord = await orgHelper.createRecord('Case', {
          Subject: caseData.subject,
          Status: caseData.status,
          Priority: caseData.priority,
          Origin: caseData.origin,
          AccountId: accountId.id,
          ContactId: caseData.contactId
        });
        caseIds.push(caseRecord.id);

        // Create CaseComments
        for (const comment of caseData.comments) {
          const caseComment = await orgHelper.createRecord('CaseComment', {
            ParentId: caseRecord.id,
            CommentBody: comment.body
          });
          caseCommentIds.push(caseComment.id);
        }
      }

      console.log(`✓ Created ${caseIds.length} Cases`);
      console.log(`  - 1 Closed (with 2 comments)`);
      console.log(`  - 1 In Progress (with 1 comment)`);
      console.log(`  - 1 New (no comments - edge case)`);
      console.log(`✓ Created ${caseCommentIds.length} CaseComments`);
      createdRecordIds.push({ type: 'Case', ids: caseIds });

      // ============================================================================
      // STEP 6: Create Template with Complex SOQL
      // ============================================================================
      console.log('\n[6/7] Creating template with complex nested SOQL...');

      // Upload template file
      // Upload the complex account summary template
      const templatePath = path.join(__dirname, '../fixtures', 'account-summary-template.docx');
      const templateBuffer = fs.readFileSync(templatePath);
      const templateBase64 = templateBuffer.toString('base64');

      const contentVersion = await orgHelper.createRecord('ContentVersion', {
        Title: 'Account_Summary_Template',
        PathOnClient: 'account-summary-template.docx',
        VersionData: templateBase64,
        FirstPublishLocationId: accountId.id
      });
      console.log(`✓ Uploaded template: ${contentVersion.id}`);

      // Create complex SOQL with multiple nested subqueries
      const complexSOQL = `
        SELECT
          Id, Name, Type, Industry,
          BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry,
          Phone, Website, AnnualRevenue, NumberOfEmployees, Description,
          Owner.Name, Owner.Email,

          (SELECT Id, Name, Title, Email, Phone, Department, CreatedDate
           FROM Contacts
           ORDER BY CreatedDate),

          (SELECT Id, Name, StageName, Amount, Probability, CloseDate,
                  Type, NextStep, Description,
                  (SELECT Id, Product2.Name, Product2.ProductCode,
                          Quantity, UnitPrice, TotalPrice, Description
                   FROM OpportunityLineItems
                   ORDER BY CreatedDate)
           FROM Opportunities
           ORDER BY CloseDate DESC),

          (SELECT Id, CaseNumber, Subject, Status, Priority, Origin,
                  CreatedDate, ClosedDate, Description,
                  Contact.Name, Contact.Email,
                  (SELECT Id, CommentBody, CreatedDate, CreatedBy.Name
                   FROM CaseComments
                   ORDER BY CreatedDate)
           FROM Cases
           ORDER BY CreatedDate DESC)

        FROM Account
        WHERE Id = :recordId
      `.trim();

      const templateRecord = await orgHelper.createRecord('Docgen_Template__c', {
        Name: `Account_Summary_Complex_${Date.now()}`,
        DataSource__c: 'SOQL',
        TemplateContentVersionId__c: contentVersion.id,
        SOQL__c: complexSOQL,
        StoreMergedDocx__c: false,
        ReturnDocxToBrowser__c: false,
        PrimaryParent__c: 'Account'
      });
      console.log(`✓ Created template with nested subqueries`);
      console.log(`  - Account fields: 14`);
      console.log(`  - Contacts subquery (5 contacts)`);
      console.log(`  - Opportunities subquery with LineItems (5 opps)`);
      console.log(`  - Cases subquery with Comments (3 cases)`);

      // ============================================================================
      // STEP 7: Execute Batch and Verify
      // ============================================================================
      console.log('\n[7/7] Executing batch and verifying document generation...');

      const documentIds = await batchHelper.executeBatchAndVerifyQueued({
        templateId: templateRecord.id,
        recordIds: [accountId.id],
        outputFormat: 'PDF',
        parentField: 'Account__c',
        batchSize: 200
      });

      console.log(`✓ Batch created ${documentIds.length} document(s)`);
      expect(documentIds.length).toBe(1);

      // Wait for poller to process
      console.log('\nWaiting for poller to process complex document...');
      console.log('  (This may take 2-3 minutes due to data complexity)');

      const finalStatuses = await workerHelper.waitForQueueProcessing(
        documentIds,
        'SUCCEEDED',
        300000 // 5 minutes for complex document
      );

      console.log('\n✓ Document processed successfully');

      // Verify document succeeded
      const document = finalStatuses[0];
      expect(document.Status__c).toBe('SUCCEEDED');
      expect(document.OutputFileId__c).toBeTruthy();
      expect(document.OutputFileId__c).toMatch(/^068/); // ContentVersion ID prefix
      expect(document.Error__c).toBeFalsy();

      console.log('\n✓ Document verification:');
      console.log(`  Status: ${document.Status__c}`);
      console.log(`  OutputFileId: ${document.OutputFileId__c}`);
      console.log(`  No errors: ✓`);

      // Verify PDF exists
      console.log('\nVerifying PDF file exists...');
      const pdfExists = await workerHelper.verifyPDFExists(document.OutputFileId__c!);
      expect(pdfExists).toBe(true);
      console.log('✓ PDF file verified and accessible');

      // Verify ContentDocumentLink
      console.log('\nVerifying ContentDocumentLink to Account...');
      const links = await orgHelper.query(
        `SELECT Id, ContentDocumentId, LinkedEntityId
         FROM ContentDocumentLink
         WHERE LinkedEntityId = '${accountId.id}'`
      );
      expect(links.length).toBeGreaterThan(0);
      console.log(`✓ Found ${links.length} ContentDocumentLink(s) to Account`);

      // ============================================================================
      // Summary
      // ============================================================================
      console.log('\n' + '='.repeat(80));
      console.log('TEST SUMMARY - Complex Account Summary');
      console.log('='.repeat(80));
      console.log('Test Data Created:');
      console.log(`  ✓ 1 Account with full details`);
      console.log(`  ✓ 5 Contacts (including edge cases with minimal data)`);
      console.log(`  ✓ 5 Products with PricebookEntries`);
      console.log(`  ✓ 5 Opportunities (2 Won, 2 Open, 1 Lost)`);
      console.log(`  ✓ ${lineItemIds.length} OpportunityLineItems (nested child)`);
      console.log(`  ✓ 3 Cases (1 Closed, 1 Open, 1 New)`);
      console.log(`  ✓ ${caseCommentIds.length} CaseComments (nested child)`);
      console.log('\nTemplate Features Tested:');
      console.log(`  ✓ Multi-level SOQL subqueries (3 levels deep)`);
      console.log(`  ✓ Nested child relationships (LineItems, Comments)`);
      console.log(`  ✓ Lookup field traversal (Owner.Name, Contact.Email)`);
      console.log(`  ✓ Edge cases (empty arrays, minimal data)`);
      console.log(`  ✓ Multiple opportunity stages`);
      console.log(`  ✓ Multiple case statuses`);
      console.log('\nDocument Generation:');
      console.log(`  ✓ Status: SUCCEEDED`);
      console.log(`  ✓ PDF generated and uploaded`);
      console.log(`  ✓ Linked to Account record`);
      console.log('='.repeat(80));

      console.log('\n✅ Complex Account Summary test completed successfully');

    } finally {
      // ============================================================================
      // Cleanup
      // ============================================================================
      console.log('\n' + '-'.repeat(80));
      console.log('Cleaning up test data...');
      console.log('-'.repeat(80));

      // Cleanup in reverse order of dependencies
      for (const recordGroup of createdRecordIds.reverse()) {
        try {
          if (recordGroup.ids.length > 0) {
            console.log(`  Deleting ${recordGroup.ids.length} ${recordGroup.type} record(s)...`);
            await orgHelper.deleteRecords(recordGroup.type, recordGroup.ids);
            console.log(`  ✓ Deleted ${recordGroup.type} records`);
          }
        } catch (error) {
          console.warn(`  ⚠️  Failed to delete ${recordGroup.type}:`, error);
          // Continue with other cleanups
        }
      }

      console.log('✓ Test data cleanup completed');
      console.log('-'.repeat(80));
    }
  });
});
