/**
 * E2E tests for multi-object document generation
 * Tests Contact, Lead, and Opportunity with full integration
 */
import { test, expect } from '../fixtures/salesforce.fixture';
import { DocgenTestPage } from '../pages/DocgenTestPage';
import { createRecord, querySalesforce, waitForSalesforceRecord, deleteRecords } from '../utils/scratch-org';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Upload a template file and return its ContentVersionId
 */
async function uploadTemplate(templateFileName: string, recordId: string): Promise<string> {
    const templatePath = path.join(__dirname, '../fixtures', templateFileName);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found: ${templatePath}`);
    }

    const templateBuffer = fs.readFileSync(templatePath);
    const templateBase64 = templateBuffer.toString('base64');

    const contentVersionId = await createRecord('ContentVersion', {
        Title: `E2E_${templateFileName}`,
        PathOnClient: templateFileName,
        VersionData: templateBase64,
        FirstPublishLocationId: recordId,
    });

    // Wait for ContentDocument creation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return contentVersionId;
}

test.describe('Multi-Object Document Generation', () => {

    test('generates PDF for Contact successfully', async ({ salesforce }) => {
        console.log('\n='.repeat(70));
        console.log('TEST: generates PDF for Contact successfully');
        console.log('='.repeat(70));

        // Given: Contact record exists
        const contactData = {
            FirstName: 'Test',
            LastName: 'Contact E2E',
            Email: 'teste2e.contact@example.com'
        };
        const contactId = await createRecord('Contact', contactData);
        console.log(`✓ Created Contact: ${contactId}`);

        // And: Upload Contact-specific template
        const contentVersionId = await uploadTemplate('test-template-contact.docx', contactId);
        console.log(`✓ Uploaded Contact template: ${contentVersionId}`);

        // And: Template configured for Contact
        const templateData = {
            Name: 'Contact E2E Template',
            PrimaryParent__c: 'Contact',
            DataSource__c: 'SOQL',
            SOQL__c: 'SELECT Id, FirstName, LastName, Email FROM Contact WHERE Id = :recordId',
            TemplateContentVersionId__c: contentVersionId,
            StoreMergedDocx__c: false,
            ReturnDocxToBrowser__c: true
        };
        const templateId = await createRecord('Docgen_Template__c', templateData);
        console.log(`✓ Created Template: ${templateId}`);

        // When: Navigate to Contact record page
        const testPage = new DocgenTestPage(salesforce.authenticatedPage);
        await testPage.goto(contactId, templateId);
        await testPage.waitForRecordDetailsLoaded();
        console.log('✓ Contact record page loaded');

        // Click generate button
        console.log('Clicking generate button...');
        await testPage.clickGenerateButton();
        await testPage.waitForSpinnerVisible();
        await testPage.waitForSpinnerHidden();
        console.log('✓ Button clicked and spinner disappeared');

        // Then: Generated_Document__c should be created with SUCCEEDED status
        console.log('Polling for Generated_Document__c with Status=SUCCEEDED...');
        const docs = await waitForSalesforceRecord(
            () => querySalesforce(
                `SELECT Id, Contact__c, Status__c, OutputFileId__c, Error__c
                 FROM Generated_Document__c
                 WHERE Template__c = '${templateId}'
                 AND Contact__c = '${contactId}'
                 AND Status__c = 'SUCCEEDED'`
            ),
            {
                description: 'Generated document for Contact with SUCCEEDED status',
                maxAttempts: 30,
                delayMs: 3000
            }
        );

        expect(docs.length).toBe(1);
        expect(docs[0].Contact__c).toBe(contactId);
        expect(docs[0].Status__c).toBe('SUCCEEDED');
        expect(docs[0].Error__c).toBeNull();
        expect(docs[0].OutputFileId__c).toBeTruthy();
        expect(docs[0].OutputFileId__c).toMatch(/^068/); // ContentVersion ID prefix

        console.log(`✓ Generated_Document__c created: ${docs[0].Id}`);

        // And: ContentDocumentLink should exist for Contact
        const linkQuery = `SELECT Id, LinkedEntityId
                           FROM ContentDocumentLink
                           WHERE LinkedEntityId = '${contactId}'`;
        const links = await querySalesforce(linkQuery);
        expect(links.length).toBeGreaterThan(0);
        console.log(`✓ ContentDocumentLink created for Contact (${links.length} link(s))`);

        console.log('✅ PDF generated successfully for Contact\n');

        // Cleanup
        await deleteRecords('Generated_Document__c', [docs[0].Id]);
        await deleteRecords('Docgen_Template__c', [templateId]);
        await deleteRecords('ContentVersion', [contentVersionId]);
        await deleteRecords('Contact', [contactId]);
    });

    test('generates PDF for Lead successfully', async ({ salesforce }) => {
        console.log('\n='.repeat(70));
        console.log('TEST: generates PDF for Lead successfully');
        console.log('='.repeat(70));

        // Given: Lead record exists
        const leadData = {
            FirstName: 'Test',
            LastName: 'Lead E2E',
            Company: 'Test Company E2E',
            Email: 'teste2e.lead@example.com',
            Status: 'Open - Not Contacted'
        };
        const leadId = await createRecord('Lead', leadData);
        console.log(`✓ Created Lead: ${leadId}`);

        // And: Upload Lead-specific template
        const contentVersionId = await uploadTemplate('test-template-lead.docx', leadId);
        console.log(`✓ Uploaded Lead template: ${contentVersionId}`);

        // And: Template configured for Lead
        const templateData = {
            Name: 'Lead E2E Template',
            PrimaryParent__c: 'Lead',
            DataSource__c: 'SOQL',
            SOQL__c: 'SELECT Id, FirstName, LastName, Company, Email, Status FROM Lead WHERE Id = :recordId',
            TemplateContentVersionId__c: contentVersionId,
            StoreMergedDocx__c: false,
            ReturnDocxToBrowser__c: true
        };
        const templateId = await createRecord('Docgen_Template__c', templateData);
        console.log(`✓ Created Template: ${templateId}`);

        // When: Navigate to Lead record page
        const testPage = new DocgenTestPage(salesforce.authenticatedPage);
        await testPage.goto(leadId, templateId);
        await testPage.waitForRecordDetailsLoaded();
        console.log('✓ Lead record page loaded');

        // Click generate button
        console.log('Clicking generate button...');
        await testPage.clickGenerateButton();
        await testPage.waitForSpinnerVisible();
        await testPage.waitForSpinnerHidden();
        console.log('✓ Button clicked and spinner disappeared');

        // Then: Generated_Document__c should be created with SUCCEEDED status
        console.log('Polling for Generated_Document__c with Status=SUCCEEDED...');
        const docs = await waitForSalesforceRecord(
            () => querySalesforce(
                `SELECT Id, Lead__c, Status__c, OutputFileId__c, Error__c
                 FROM Generated_Document__c
                 WHERE Template__c = '${templateId}'
                 AND Lead__c = '${leadId}'
                 AND Status__c = 'SUCCEEDED'`
            ),
            {
                description: 'Generated document for Lead with SUCCEEDED status',
                maxAttempts: 30,
                delayMs: 3000
            }
        );

        expect(docs.length).toBe(1);
        expect(docs[0].Lead__c).toBe(leadId);
        expect(docs[0].Status__c).toBe('SUCCEEDED');
        expect(docs[0].Error__c).toBeNull();
        expect(docs[0].OutputFileId__c).toBeTruthy();
        expect(docs[0].OutputFileId__c).toMatch(/^068/); // ContentVersion ID prefix

        console.log(`✓ Generated_Document__c created: ${docs[0].Id}`);

        // And: ContentDocumentLink should exist for Lead
        const linkQuery = `SELECT Id, LinkedEntityId
                           FROM ContentDocumentLink
                           WHERE LinkedEntityId = '${leadId}'`;
        const links = await querySalesforce(linkQuery);
        expect(links.length).toBeGreaterThan(0);
        console.log(`✓ ContentDocumentLink created for Lead (${links.length} link(s))`);

        console.log('✅ PDF generated successfully for Lead\n');

        // Cleanup
        await deleteRecords('Generated_Document__c', [docs[0].Id]);
        await deleteRecords('Docgen_Template__c', [templateId]);
        await deleteRecords('ContentVersion', [contentVersionId]);
        await deleteRecords('Lead', [leadId]);
    });

    test('generates PDF for Opportunity successfully', async ({ salesforce }) => {
        console.log('\n='.repeat(70));
        console.log('TEST: generates PDF for Opportunity successfully');
        console.log('='.repeat(70));

        // Given: Account and Opportunity exist
        const accountData = {
            Name: 'Test Account for Opp E2E',
            BillingCity: 'San Francisco'
        };
        const accountId = await createRecord('Account', accountData);
        console.log(`✓ Created Account: ${accountId}`);

        const oppData = {
            Name: 'Test Opportunity E2E',
            StageName: 'Prospecting',
            CloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
            AccountId: accountId,
            Amount: 50000
        };
        const oppId = await createRecord('Opportunity', oppData);
        console.log(`✓ Created Opportunity: ${oppId}`);

        // And: Upload Opportunity-specific template
        const contentVersionId = await uploadTemplate('test-template-opportunity.docx', oppId);
        console.log(`✓ Uploaded Opportunity template: ${contentVersionId}`);

        // And: Template configured for Opportunity
        const templateData = {
            Name: 'Opportunity E2E Template',
            PrimaryParent__c: 'Opportunity',
            DataSource__c: 'SOQL',
            SOQL__c: 'SELECT Id, Name, StageName, CloseDate, Amount, AccountId, Account.Name FROM Opportunity WHERE Id = :recordId',
            TemplateContentVersionId__c: contentVersionId,
            StoreMergedDocx__c: false,
            ReturnDocxToBrowser__c: true
        };
        const templateId = await createRecord('Docgen_Template__c', templateData);
        console.log(`✓ Created Template: ${templateId}`);

        // When: Navigate to Opportunity record page
        const testPage = new DocgenTestPage(salesforce.authenticatedPage);
        await testPage.goto(oppId, templateId);
        await testPage.waitForRecordDetailsLoaded();
        console.log('✓ Opportunity record page loaded');

        // Click generate button
        console.log('Clicking generate button...');
        await testPage.clickGenerateButton();
        await testPage.waitForSpinnerVisible();
        await testPage.waitForSpinnerHidden();
        console.log('✓ Button clicked and spinner disappeared');

        // Then: Generated_Document__c should be created with SUCCEEDED status
        console.log('Polling for Generated_Document__c with Status=SUCCEEDED...');
        const docs = await waitForSalesforceRecord(
            () => querySalesforce(
                `SELECT Id, Opportunity__c, Account__c, Status__c, OutputFileId__c, Error__c
                 FROM Generated_Document__c
                 WHERE Template__c = '${templateId}'
                 AND Opportunity__c = '${oppId}'
                 AND Status__c = 'SUCCEEDED'`
            ),
            {
                description: 'Generated document for Opportunity with SUCCEEDED status',
                maxAttempts: 30,
                delayMs: 3000
            }
        );

        expect(docs.length).toBe(1);
        expect(docs[0].Opportunity__c).toBe(oppId);
        expect(docs[0].Status__c).toBe('SUCCEEDED');
        expect(docs[0].Error__c).toBeNull();
        expect(docs[0].OutputFileId__c).toBeTruthy();
        expect(docs[0].OutputFileId__c).toMatch(/^068/); // ContentVersion ID prefix

        console.log(`✓ Generated_Document__c created: ${docs[0].Id}`);
        console.log(`✓ Account relationship set: ${docs[0].Account__c}`);

        // And: ContentDocumentLinks should exist for both Opportunity and Account
        const oppLinkQuery = `SELECT Id, LinkedEntityId
                              FROM ContentDocumentLink
                              WHERE LinkedEntityId = '${oppId}'`;
        const oppLinks = await querySalesforce(oppLinkQuery);
        expect(oppLinks.length).toBeGreaterThan(0);
        console.log(`✓ ContentDocumentLink created for Opportunity (${oppLinks.length} link(s))`);

        const accLinkQuery = `SELECT Id, LinkedEntityId
                              FROM ContentDocumentLink
                              WHERE LinkedEntityId = '${accountId}'`;
        const accLinks = await querySalesforce(accLinkQuery);
        expect(accLinks.length).toBeGreaterThan(0);
        console.log(`✓ ContentDocumentLink created for Account (${accLinks.length} link(s))`);

        console.log('✅ PDF generated successfully for Opportunity with Account relationship\n');

        // Cleanup
        await deleteRecords('Generated_Document__c', [docs[0].Id]);
        await deleteRecords('Docgen_Template__c', [templateId]);
        await deleteRecords('ContentVersion', [contentVersionId]);
        await deleteRecords('Opportunity', [oppId]);
        await deleteRecords('Account', [accountId]);
    });

    test('verifies dynamic lookup fields are correctly set for all object types', async ({ salesforce }) => {
        console.log('\n='.repeat(70));
        console.log('TEST: verifies dynamic lookup fields for all object types');
        console.log('='.repeat(70));

        // Given: One record of each type with documents generated
        const objectTypes = [
            { type: 'Contact', lookupField: 'Contact__c', data: { FirstName: 'Test', LastName: 'Contact Lookup', Email: 'lookup.contact@example.com' } },
            { type: 'Lead', lookupField: 'Lead__c', data: { FirstName: 'Test', LastName: 'Lead Lookup', Company: 'Test Co', Email: 'lookup.lead@example.com', Status: 'Open - Not Contacted' } }
        ];

        const testResults: Array<{objectType: string, lookupField: string, recordId: string, docId: string}> = [];

        for (const objType of objectTypes) {
            console.log(`\nProcessing ${objType.type}...`);

            // Create record
            const recordId = await createRecord(objType.type, objType.data);
            console.log(`  ✓ Created ${objType.type}: ${recordId}`);

            // Create template
            const soqlMap: Record<string, string> = {
                'Contact': 'SELECT Id, Name FROM Contact WHERE Id = :recordId',
                'Lead': 'SELECT Id, Name FROM Lead WHERE Id = :recordId'
            };

            const templateId = await createRecord('Docgen_Template__c', {
                Name: `${objType.type} Lookup Test Template`,
                PrimaryParent__c: objType.type,
                DataSource__c: 'SOQL',
                SOQL__c: soqlMap[objType.type],
                TemplateContentVersionId__c: salesforce.testData.contentVersionId
            });
            console.log(`  ✓ Created Template: ${templateId}`);

            // Create Generated_Document__c with dynamic lookup
            const docData: any = {
                Template__c: templateId,
                Status__c: 'QUEUED',
                OutputFormat__c: 'PDF',
                RequestHash__c: `lookup-test-${objType.type}-${Date.now()}`
            };
            docData[objType.lookupField] = recordId;

            const docId = await createRecord('Generated_Document__c', docData);
            console.log(`  ✓ Created Generated_Document__c: ${docId}`);

            testResults.push({
                objectType: objType.type,
                lookupField: objType.lookupField,
                recordId,
                docId
            });
        }

        // Then: Verify all lookups are correctly set
        console.log('\nVerifying dynamic lookup fields...');
        for (const result of testResults) {
            const query = `SELECT Id, ${result.lookupField} FROM Generated_Document__c WHERE Id = '${result.docId}'`;
            const docs = await querySalesforce(query);

            expect(docs.length).toBe(1);
            expect(docs[0][result.lookupField]).toBe(result.recordId);
            console.log(`  ✓ ${result.objectType}: ${result.lookupField} correctly set to ${result.recordId}`);
        }

        console.log('✅ All dynamic lookup fields verified successfully\n');
    });
});
