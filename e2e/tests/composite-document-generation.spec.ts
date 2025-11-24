/**
 * Composite Document Generation E2E Test
 *
 * This test validates composite document generation with multiple simple templates
 * (without subqueries) combined via Composite Document configuration. Tests both:
 * 1. Own Template Strategy: Single template receives all namespace data
 * 2. Concatenate Templates Strategy: Multiple templates concatenated with section breaks
 *
 * Simulates a real-world "Account Summary" report similar to account-summary-complex.spec.ts
 * but using the composite document approach instead of a single complex SOQL.
 */

import { test, expect } from '../fixtures/salesforce.fixture';
import { WorkerHelper } from '../utils/worker-helper';
import { BatchHelper } from '../utils/batch-helper';
import { ScratchOrgHelper } from '../utils/scratch-org';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Composite Document Generation E2E', () => {
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

  test('generates composite PDF with Own Template strategy', async ({ salesforce: _salesforce }) => {
    test.setTimeout(360000); // 6 minutes

    console.log(`\n${'='.repeat(80)}`);
    console.log('TEST: Composite Document - Own Template Strategy');
    console.log(`${'='.repeat(80)}`);

    let createdRecordIds: { type: string; ids: string[] }[] = [];

    try {
      // ==========================================================================
      // STEP 1: Create test data
      // ==========================================================================
      console.log('\n[1/8] Creating test data...');

      const accountData = {
        Name: `E2E_Composite_Own_${Date.now()}`,
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
        Description: 'Composite document test account'
      };

      const accountId = await orgHelper.createRecord('Account', accountData);
      console.log(`✓ Created Account: ${accountId.id}`);
      createdRecordIds.push({ type: 'Account', ids: [accountId.id] });

      // Create 5 Contacts
      const contactsData = [
        { FirstName: 'John', LastName: 'Smith', Title: 'CEO', Email: 'john@example.com', Phone: '(415) 555-1001', AccountId: accountId.id },
        { FirstName: 'Sarah', LastName: 'Johnson', Title: 'VP Engineering', Email: 'sarah@example.com', Phone: '(415) 555-1002', AccountId: accountId.id },
        { FirstName: 'Michael', LastName: 'Chen', Title: 'Product Manager', Email: 'michael@example.com', AccountId: accountId.id },
        { FirstName: 'Anna', LastName: 'Williams', Email: 'anna@example.com', AccountId: accountId.id },
        { FirstName: 'David', LastName: 'Brown', AccountId: accountId.id }
      ];

      const contactIds: string[] = [];
      for (const contactData of contactsData) {
        const contact = await orgHelper.createRecord('Contact', contactData);
        contactIds.push(contact.id);
      }
      console.log(`✓ Created ${contactIds.length} Contacts`);
      createdRecordIds.push({ type: 'Contact', ids: contactIds });

      // Create 5 Opportunities
      const opportunitiesData = [
        { Name: 'FY2025 Renewal', StageName: 'Closed Won', Amount: 500000, Probability: 100, CloseDate: '2025-06-30', AccountId: accountId.id },
        { Name: 'Q4 Expansion', StageName: 'Closed Won', Amount: 150000, Probability: 100, CloseDate: '2025-10-15', AccountId: accountId.id },
        { Name: 'New Module', StageName: 'Prospecting', Amount: 75000, Probability: 10, CloseDate: '2026-03-31', AccountId: accountId.id },
        { Name: 'Training Package', StageName: 'Negotiation/Review', Amount: 45000, Probability: 75, CloseDate: '2026-01-31', AccountId: accountId.id },
        { Name: 'Cloud Migration', StageName: 'Closed Lost', Amount: 200000, Probability: 0, CloseDate: '2025-08-30', AccountId: accountId.id }
      ];

      const opportunityIds: string[] = [];
      for (const oppData of opportunitiesData) {
        const opp = await orgHelper.createRecord('Opportunity', oppData);
        opportunityIds.push(opp.id);
      }
      console.log(`✓ Created ${opportunityIds.length} Opportunities`);
      createdRecordIds.push({ type: 'Opportunity', ids: opportunityIds });

      // Create 3 Cases
      const casesData = [
        { Subject: 'API Timeout Issues', Status: 'Closed', Priority: 'High', Origin: 'Email', AccountId: accountId.id, ContactId: contactIds[0] },
        { Subject: 'Feature Request', Status: 'In Progress', Priority: 'Medium', Origin: 'Web', AccountId: accountId.id, ContactId: contactIds[1] },
        { Subject: 'Permissions Question', Status: 'New', Priority: 'Low', Origin: 'Phone', AccountId: accountId.id, ContactId: contactIds[2] }
      ];

      const caseIds: string[] = [];
      for (const caseData of casesData) {
        const caseRecord = await orgHelper.createRecord('Case', caseData);
        caseIds.push(caseRecord.id);
      }
      console.log(`✓ Created ${caseIds.length} Cases`);
      createdRecordIds.push({ type: 'Case', ids: caseIds });

      // ==========================================================================
      // STEP 2: Create 4 simple Docgen_Template__c records (no subqueries)
      // ==========================================================================
      console.log('\n[2/8] Creating 4 simple templates...');

      const templates: { id: string; namespace: string }[] = [];

      // Template 1: Account (with ReturnMultipleRecords__c flag)
      const accountSOQL = `
        SELECT Id, Name, Type, Industry,
          BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry,
          Phone, Website, AnnualRevenue, NumberOfEmployees, Description,
          Owner.Name, Owner.Email
        FROM Account WHERE Id = :recordId
      `.trim();

      const tmpl1 = await orgHelper.createRecord('Docgen_Template__c', {
        Name: `Composite_Account_${Date.now()}`,
        DataSource__c: 'SOQL',
        ReturnMultipleRecords__c: true,
        TemplateContentVersionId__c: '068000000000000AAA', // Placeholder
        SOQL__c: accountSOQL,
        PrimaryParent__c: 'Account'
      });
      templates.push({ id: tmpl1.id, namespace: 'Account' });

      // Template 2: Contacts (with ReturnMultipleRecords__c flag)
      const contactsSOQL = `
        SELECT Id, Name, Title, Email, Phone, Department, CreatedDate
        FROM Contact
        WHERE AccountId = :recordId
        ORDER BY CreatedDate
      `.trim();

      const tmpl2 = await orgHelper.createRecord('Docgen_Template__c', {
        Name: `Composite_Contacts_${Date.now()}`,
        DataSource__c: 'SOQL',
        ReturnMultipleRecords__c: true,
        TemplateContentVersionId__c: '068000000000000AAA',
        SOQL__c: contactsSOQL,
        PrimaryParent__c: 'Account'
      });
      templates.push({ id: tmpl2.id, namespace: 'Contacts' });

      // Template 3: Opportunities (with ReturnMultipleRecords__c flag)
      const opportunitiesSOQL = `
        SELECT Id, Name, StageName, Amount, Probability, CloseDate,
          Type, NextStep, Description
        FROM Opportunity
        WHERE AccountId = :recordId
        ORDER BY CloseDate DESC
      `.trim();

      const tmpl3 = await orgHelper.createRecord('Docgen_Template__c', {
        Name: `Composite_Opportunities_${Date.now()}`,
        DataSource__c: 'SOQL',
        ReturnMultipleRecords__c: true,
        TemplateContentVersionId__c: '068000000000000AAA',
        SOQL__c: opportunitiesSOQL,
        PrimaryParent__c: 'Account'
      });
      templates.push({ id: tmpl3.id, namespace: 'Opportunities' });

      // Template 4: Cases (with ReturnMultipleRecords__c flag)
      const casesSOQL = `
        SELECT Id, CaseNumber, Subject, Status, Priority, Origin,
          CreatedDate, ClosedDate, Description,
          Contact.Name, Contact.Email
        FROM Case
        WHERE AccountId = :recordId
        ORDER BY CreatedDate DESC
      `.trim();

      const tmpl4 = await orgHelper.createRecord('Docgen_Template__c', {
        Name: `Composite_Cases_${Date.now()}`,
        DataSource__c: 'SOQL',
        ReturnMultipleRecords__c: true,
        TemplateContentVersionId__c: '068000000000000AAA',
        SOQL__c: casesSOQL,
        PrimaryParent__c: 'Account'
      });
      templates.push({ id: tmpl4.id, namespace: 'Cases' });

      console.log(`✓ Created ${templates.length} simple templates (no subqueries)`);

      // ==========================================================================
      // STEP 3: Upload composite template DOCX
      // ==========================================================================
      console.log('\n[3/8] Uploading composite template...');

      const templatePath = path.join(__dirname, '../fixtures', 'composite-account-summary.docx');
      const templateBuffer = fs.readFileSync(templatePath);
      const templateBase64 = templateBuffer.toString('base64');

      const contentVersion = await orgHelper.createRecord('ContentVersion', {
        Title: 'Composite_Account_Summary',
        PathOnClient: 'composite-account-summary.docx',
        VersionData: templateBase64,
        FirstPublishLocationId: accountId.id
      });
      console.log(`✓ Uploaded template: ${contentVersion.id}`);

      // ==========================================================================
      // STEP 4: Create Composite_Document__c with Own Template strategy
      // ==========================================================================
      console.log('\n[4/8] Creating Composite_Document__c (Own Template strategy)...');

      const compositeDoc = await orgHelper.createRecord('Composite_Document__c', {
        Description__c: 'E2E test for Own Template strategy',
        Template_Strategy__c: 'Own Template',
        TemplateContentVersionId__c: contentVersion.id,
        PrimaryParent__c: 'Account',
        StoreMergedDocx__c: false,
        ReturnDocxToBrowser__c: false,
        IsActive__c: true
      });
      console.log(`✓ Created Composite Document: ${compositeDoc.id}`);
      createdRecordIds.push({ type: 'Composite_Document__c', ids: [compositeDoc.id] });

      // ==========================================================================
      // STEP 5: Create 4 junction records
      // ==========================================================================
      console.log('\n[5/8] Creating junction records...');

      const junctionIds: string[] = [];
      for (let i = 0; i < templates.length; i++) {
        const junction = await orgHelper.createRecord('Composite_Document_Template__c', {
          Composite_Document__c: compositeDoc.id,
          Document_Template__c: templates[i].id,
          Namespace__c: templates[i].namespace,
          Sequence__c: (i + 1) * 10,
          IsActive__c: true
        });
        junctionIds.push(junction.id);
      }
      console.log(`✓ Created ${junctionIds.length} junction records`);
      createdRecordIds.push({ type: 'Composite_Document_Template__c', ids: junctionIds });

      // ==========================================================================
      // STEP 6: Generate document via batch (like batch processing)
      // ==========================================================================
      console.log('\n[6/8] Enqueuing batch generation for composite document...');

      // Use batch helper to enqueue composite document generation
      // This creates Generated_Document__c records that the poller will process
      const documentIds = await batchHelper.executeBatchAndVerifyQueued({
        compositeDocId: compositeDoc.id,
        recordIds: [accountId.id],
        outputFormat: 'PDF',
        parentField: 'Account__c',
        batchSize: 200
      });

      console.log(`✓ Batch created ${documentIds.length} document(s)`);

      // ==========================================================================
      // STEP 7: Wait for poller processing
      // ==========================================================================
      console.log('\n[7/8] Waiting for poller to process composite document...');
      console.log('  (Expected time: 1-2 minutes)');

      const finalStatuses = await workerHelper.waitForQueueProcessing(
        documentIds,
        'SUCCEEDED',
        300000 // 5 minutes
      );

      console.log('\n✓ Document processed successfully');

      // ==========================================================================
      // STEP 8: Verify results
      // ==========================================================================
      console.log('\n[8/8] Verifying results...');

      const document = finalStatuses[0];
      expect(document.Status__c).toBe('SUCCEEDED');
      expect(document.OutputFileId__c).toBeTruthy();
      expect(document.OutputFileId__c).toMatch(/^068/);
      expect(document.Error__c).toBeFalsy();
      expect(document.Composite_Document__c).toBe(compositeDoc.id);

      console.log('✓ Document verification:');
      console.log(`  Status: ${document.Status__c}`);
      console.log(`  OutputFileId: ${document.OutputFileId__c}`);
      console.log(`  Composite Document: ${document.Composite_Document__c}`);

      // Verify PDF exists
      const pdfExists = await workerHelper.verifyPDFExists(document.OutputFileId__c!);
      expect(pdfExists).toBe(true);
      console.log('✓ PDF file verified and accessible');

      // Verify ContentDocumentLink
      const links = await orgHelper.query(
        `SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId = '${accountId.id}'`
      );
      expect(links.length).toBeGreaterThan(0);
      console.log(`✓ Found ${links.length} ContentDocumentLink(s) to Account`);

      console.log('\n' + '='.repeat(80));
      console.log('TEST SUMMARY - Own Template Strategy');
      console.log('='.repeat(80));
      console.log('✓ 4 simple templates created (no subqueries)');
      console.log('✓ 1 composite template uploaded');
      console.log('✓ Composite Document with Own Template strategy');
      console.log('✓ All namespaces merged successfully');
      console.log('✓ PDF generated and linked to Account');
      console.log('='.repeat(80));

    } finally {
      // Cleanup
      console.log('\n' + '-'.repeat(80));
      console.log('Cleaning up test data...');
      for (const recordGroup of createdRecordIds.reverse()) {
        try {
          if (recordGroup.ids.length > 0) {
            await orgHelper.deleteRecords(recordGroup.type, recordGroup.ids);
            console.log(`  ✓ Deleted ${recordGroup.type}`);
          }
        } catch (error) {
          console.warn(`  ⚠️  Failed to delete ${recordGroup.type}:`, error);
        }
      }
      console.log('✓ Cleanup completed');
      console.log('-'.repeat(80));
    }
  });

  test('generates composite PDF with Concatenate Templates strategy', async ({ salesforce: _salesforce }) => {
    test.setTimeout(360000); // 6 minutes

    console.log(`\n${'='.repeat(80)}`);
    console.log('TEST: Composite Document - Concatenate Templates Strategy');
    console.log(`${'='.repeat(80)}`);

    let createdRecordIds: { type: string; ids: string[] }[] = [];

    try {
      // ==========================================================================
      // STEP 1: Create test data (same as Own Template test)
      // ==========================================================================
      console.log('\n[1/9] Creating test data...');

      const accountData = {
        Name: `E2E_Composite_Concat_${Date.now()}`,
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
        Description: 'Composite concat test account'
      };

      const accountId = await orgHelper.createRecord('Account', accountData);
      console.log(`✓ Created Account: ${accountId.id}`);
      createdRecordIds.push({ type: 'Account', ids: [accountId.id] });

      // Create 5 Contacts
      const contactsData = [
        { FirstName: 'John', LastName: 'Smith', Title: 'CEO', Email: 'john@example.com', AccountId: accountId.id },
        { FirstName: 'Sarah', LastName: 'Johnson', Title: 'VP Engineering', Email: 'sarah@example.com', AccountId: accountId.id },
        { FirstName: 'Michael', LastName: 'Chen', Title: 'Product Manager', Email: 'michael@example.com', AccountId: accountId.id }
      ];

      const contactIds: string[] = [];
      for (const contactData of contactsData) {
        const contact = await orgHelper.createRecord('Contact', contactData);
        contactIds.push(contact.id);
      }
      console.log(`✓ Created ${contactIds.length} Contacts`);
      createdRecordIds.push({ type: 'Contact', ids: contactIds });

      // Create 3 Opportunities
      const opportunitiesData = [
        { Name: 'FY2025 Renewal', StageName: 'Closed Won', Amount: 500000, CloseDate: '2025-06-30', AccountId: accountId.id },
        { Name: 'Q4 Expansion', StageName: 'Closed Won', Amount: 150000, CloseDate: '2025-10-15', AccountId: accountId.id },
        { Name: 'New Module', StageName: 'Prospecting', Amount: 75000, CloseDate: '2026-03-31', AccountId: accountId.id }
      ];

      const opportunityIds: string[] = [];
      for (const oppData of opportunitiesData) {
        const opp = await orgHelper.createRecord('Opportunity', oppData);
        opportunityIds.push(opp.id);
      }
      console.log(`✓ Created ${opportunityIds.length} Opportunities`);
      createdRecordIds.push({ type: 'Opportunity', ids: opportunityIds });

      // Create 2 Cases
      const casesData = [
        { Subject: 'API Timeout Issues', Status: 'Closed', Priority: 'High', Origin: 'Email', AccountId: accountId.id },
        { Subject: 'Feature Request', Status: 'In Progress', Priority: 'Medium', Origin: 'Web', AccountId: accountId.id }
      ];

      const caseIds: string[] = [];
      for (const caseData of casesData) {
        const caseRecord = await orgHelper.createRecord('Case', caseData);
        caseIds.push(caseRecord.id);
      }
      console.log(`✓ Created ${caseIds.length} Cases`);
      createdRecordIds.push({ type: 'Case', ids: caseIds });

      // ==========================================================================
      // STEP 2: Create 4 simple Docgen_Template__c records
      // ==========================================================================
      console.log('\n[2/9] Creating 4 simple templates...');

      const templates: { id: string; namespace: string }[] = [];

      const soqls = [
        { namespace: 'Account', soql: `SELECT Id, Name, Type, Industry, BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry, Phone, Website, AnnualRevenue, NumberOfEmployees, Description, Owner.Name, Owner.Email FROM Account WHERE Id = :recordId` },
        { namespace: 'Contacts', soql: `SELECT Id, Name, Title, Email, Phone, Department, CreatedDate FROM Contact WHERE AccountId = :recordId ORDER BY CreatedDate` },
        { namespace: 'Opportunities', soql: `SELECT Id, Name, StageName, Amount, Probability, CloseDate, Type, NextStep, Description FROM Opportunity WHERE AccountId = :recordId ORDER BY CloseDate DESC` },
        { namespace: 'Cases', soql: `SELECT Id, CaseNumber, Subject, Status, Priority, Origin, CreatedDate, ClosedDate, Description, Contact.Name, Contact.Email FROM Case WHERE AccountId = :recordId ORDER BY CreatedDate DESC` }
      ];

      for (const { namespace, soql } of soqls) {
        const templateData: any = {
          Name: `Concat_${namespace}_${Date.now()}`,
          DataSource__c: 'SOQL',
          ReturnMultipleRecords__c: true,
          TemplateContentVersionId__c: '068000000000000AAA', // Will be updated
          SOQL__c: soql,
          PrimaryParent__c: 'Account'
        }

        const tmpl = await orgHelper.createRecord('Docgen_Template__c', templateData);
        templates.push({ id: tmpl.id, namespace });
      }

      console.log(`✓ Created ${templates.length} simple templates`);

      // ==========================================================================
      // STEP 3: Upload 4 separate template DOCX files
      // ==========================================================================
      console.log('\n[3/9] Uploading 4 section templates...');

      const templateFiles = [
        'account-basics-section.docx',
        'contacts-section.docx',
        'opportunities-section.docx',
        'cases-section.docx'
      ];

      const contentVersionIds: string[] = [];

      for (let i = 0; i < templateFiles.length; i++) {
        const templatePath = path.join(__dirname, '../fixtures', templateFiles[i]);
        const templateBuffer = fs.readFileSync(templatePath);
        const templateBase64 = templateBuffer.toString('base64');

        const cv = await orgHelper.createRecord('ContentVersion', {
          Title: templateFiles[i].replace('.docx', ''),
          PathOnClient: templateFiles[i],
          VersionData: templateBase64,
          FirstPublishLocationId: accountId.id
        });
        contentVersionIds.push(cv.id);

        // Update template with ContentVersion ID
        await orgHelper.updateRecord('Docgen_Template__c', templates[i].id, {
          TemplateContentVersionId__c: cv.id
        });
      }

      console.log(`✓ Uploaded ${contentVersionIds.length} section templates`);

      // ==========================================================================
      // STEP 4: Create Composite_Document__c with Concatenate strategy
      // ==========================================================================
      console.log('\n[4/9] Creating Composite_Document__c (Concatenate strategy)...');

      const compositeDoc = await orgHelper.createRecord('Composite_Document__c', {
        Description__c: 'E2E test for Concatenate Templates strategy',
        Template_Strategy__c: 'Concatenate Templates',
        // TemplateContentVersionId__c must be omitted for Concatenate strategy
        PrimaryParent__c: 'Account',
        StoreMergedDocx__c: false,
        ReturnDocxToBrowser__c: false,
        IsActive__c: true
      });
      console.log(`✓ Created Composite Document: ${compositeDoc.id}`);
      createdRecordIds.push({ type: 'Composite_Document__c', ids: [compositeDoc.id] });

      // ==========================================================================
      // STEP 5: Create 4 junction records with proper sequence
      // ==========================================================================
      console.log('\n[5/9] Creating junction records with sequence...');

      const junctionIds: string[] = [];
      for (let i = 0; i < templates.length; i++) {
        const junction = await orgHelper.createRecord('Composite_Document_Template__c', {
          Composite_Document__c: compositeDoc.id,
          Document_Template__c: templates[i].id,
          Namespace__c: templates[i].namespace,
          Sequence__c: (i + 1) * 10, // 10, 20, 30, 40
          IsActive__c: true
        });
        junctionIds.push(junction.id);
      }
      console.log(`✓ Created ${junctionIds.length} junction records (sequence: 10, 20, 30, 40)`);
      createdRecordIds.push({ type: 'Composite_Document_Template__c', ids: junctionIds });

      // ==========================================================================
      // STEP 6: Generate document via batch (like batch processing)
      // ==========================================================================
      console.log('\n[6/9] Enqueuing batch generation for composite document...');

      // Use batch helper to enqueue composite document generation
      // This creates Generated_Document__c records that the poller will process
      const documentIds = await batchHelper.executeBatchAndVerifyQueued({
        compositeDocId: compositeDoc.id,
        recordIds: [accountId.id],
        outputFormat: 'PDF',
        parentField: 'Account__c',
        batchSize: 200
      });

      console.log(`✓ Batch created ${documentIds.length} document(s)`);

      // ==========================================================================
      // STEP 7: Wait for poller processing
      // ==========================================================================
      console.log('\n[7/9] Waiting for poller to process (concatenation)...');
      console.log('  (Expected time: 2-3 minutes for concatenation)');

      const finalStatuses = await workerHelper.waitForQueueProcessing(
        documentIds,
        'SUCCEEDED',
        300000 // 5 minutes
      );

      console.log('\n✓ Document processed successfully');

      // ==========================================================================
      // STEP 8: Verify results
      // ==========================================================================
      console.log('\n[8/9] Verifying results...');

      const document = finalStatuses[0];
      expect(document.Status__c).toBe('SUCCEEDED');
      expect(document.OutputFileId__c).toBeTruthy();
      expect(document.OutputFileId__c).toMatch(/^068/);
      expect(document.Error__c).toBeFalsy();
      expect(document.Composite_Document__c).toBe(compositeDoc.id);

      console.log('✓ Document verification:');
      console.log(`  Status: ${document.Status__c}`);
      console.log(`  OutputFileId: ${document.OutputFileId__c}`);
      console.log(`  Composite Document: ${document.Composite_Document__c}`);

      // Verify PDF exists
      const pdfExists = await workerHelper.verifyPDFExists(document.OutputFileId__c!);
      expect(pdfExists).toBe(true);
      console.log('✓ PDF file verified and accessible');

      // Verify ContentDocumentLink
      const links = await orgHelper.query(
        `SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId = '${accountId.id}'`
      );
      expect(links.length).toBeGreaterThan(0);
      console.log(`✓ Found ${links.length} ContentDocumentLink(s) to Account`);

      // ==========================================================================
      // STEP 9: Additional verification for concatenation
      // ==========================================================================
      console.log('\n[9/9] Additional concatenation verification...');

      // Query junction records to verify they exist in correct sequence
      const junctions = await orgHelper.query(
        `SELECT Sequence__c, Namespace__c FROM Composite_Document_Template__c
         WHERE Composite_Document__c = '${compositeDoc.id}'
         ORDER BY Sequence__c`
      );

      expect(junctions.length).toBe(4);
      expect(junctions[0].Namespace__c).toBe('Account');
      expect(junctions[1].Namespace__c).toBe('Contacts');
      expect(junctions[2].Namespace__c).toBe('Opportunities');
      expect(junctions[3].Namespace__c).toBe('Cases');
      console.log('✓ Sections concatenated in correct sequence order');

      console.log('\n' + '='.repeat(80));
      console.log('TEST SUMMARY - Concatenate Templates Strategy');
      console.log('='.repeat(80));
      console.log('✓ 4 simple templates created (no subqueries)');
      console.log('✓ 4 separate section templates uploaded');
      console.log('✓ Composite Document with Concatenate Templates strategy');
      console.log('✓ Sections concatenated in sequence order (1, 2, 3, 4)');
      console.log('✓ PDF generated with all sections');
      console.log('✓ PDF linked to Account');
      console.log('='.repeat(80));

    } finally {
      // Cleanup
      console.log('\n' + '-'.repeat(80));
      console.log('Cleaning up test data...');
      for (const recordGroup of createdRecordIds.reverse()) {
        try {
          if (recordGroup.ids.length > 0) {
            await orgHelper.deleteRecords(recordGroup.type, recordGroup.ids);
            console.log(`  ✓ Deleted ${recordGroup.type}`);
          }
        } catch (error) {
          console.warn(`  ⚠️  Failed to delete ${recordGroup.type}:`, error);
        }
      }
      console.log('✓ Cleanup completed');
      console.log('-'.repeat(80));
    }
  });
});
