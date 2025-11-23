# Composite Document Batch Processing Examples

This document provides comprehensive examples and guidance for using the `BatchDocgenEnqueue` class to mass-generate composite documents.

## Overview

The `BatchDocgenEnqueue` class supports both single-template and composite document batch processing. Composite documents allow you to combine data from multiple templates or data sources into a single output document.

## Table of Contents

1. [Single Template Batch Processing (Review)](#single-template-batch-processing)
2. [Composite Document Batch Processing](#composite-document-batch-processing)
3. [Composite with Additional Static RecordIds](#composite-with-additional-static-recordids)
4. [Best Practices](#best-practices)
5. [Batch Size Recommendations](#batch-size-recommendations)
6. [Troubleshooting](#troubleshooting)

---

## Single Template Batch Processing

For reference, here's how single-template batch processing works (existing functionality):

```apex
// Example: Generate 100 Account Summary PDFs
List<Account> accounts = [SELECT Id FROM Account LIMIT 100];
List<Id> accountIds = new List<Id>();
for (Account acc : accounts) {
    accountIds.add(acc.Id);
}

// Create batch job
BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
    templateId,     // Docgen_Template__c ID
    accountIds,     // List of Account IDs
    'PDF'          // Output format
);

// Execute with batch size of 200 (recommended for single templates)
Database.executeBatch(batch, 200);
```

**Result:** Creates 100 `Generated_Document__c` records with Status='QUEUED', each linked to its Account via the `Account__c` lookup field.

---

## Composite Document Batch Processing

Composite documents combine data from multiple templates/namespaces into a single document. Use this when you need to include data from multiple sources (e.g., Account + Terms & Conditions).

### Example 1: Simple Composite Document

This example generates composite documents for multiple accounts using a composite configuration with two namespaces: Account and Terms.

```apex
// Step 1: Get the composite document configuration
Composite_Document__c composite = [
    SELECT Id FROM Composite_Document__c
    WHERE Name = 'Account Summary with Terms'
    LIMIT 1
];

// Step 2: Get the accounts to process
List<Account> accounts = [SELECT Id FROM Account WHERE Status__c = 'Active' LIMIT 50];
List<Id> accountIds = new List<Id>();
for (Account acc : accounts) {
    accountIds.add(acc.Id);
}

// Step 3: Create the batch job
BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
    composite.Id,    // Composite_Document__c ID
    accountIds,      // List of Account IDs to iterate over
    'PDF',          // Output format
    'accountId'     // Variable name for the batch recordIds in the composite
);

// Step 4: Execute with batch size of 50-100 (recommended for composites)
Database.executeBatch(batch, 50);
```

**Key Points:**
- The 4th parameter (`'accountId'`) specifies the variable name that will hold each Account ID in the composite's recordIds map
- The composite document configuration determines which namespaces/templates are included
- Each batch execution creates a composite envelope with the `accountId` variable set to the current Account ID

**Result:** Creates 50 `Generated_Document__c` records with:
- `Composite_Document__c` = composite.Id
- `Template__c` = null
- `Status__c` = 'QUEUED'
- `Account__c` = respective Account ID (from parent lookup resolution)
- `RequestJSON__c` = Composite envelope with multi-namespace data

---

## Composite with Additional Static RecordIds

Sometimes your composite document needs a combination of dynamic IDs (from the batch list) and static IDs that remain the same for all records (e.g., a company-wide Terms & Conditions document).

### Example 2: Composite with Static Terms Document

```apex
// Step 1: Get the composite document configuration
Composite_Document__c composite = [
    SELECT Id FROM Composite_Document__c
    WHERE Name = 'Contract with Standard Terms'
    LIMIT 1
];

// Step 2: Get the static Terms & Conditions record
Terms_and_Conditions__c companyTerms = [
    SELECT Id FROM Terms_and_Conditions__c
    WHERE Is_Standard__c = true
    AND IsActive__c = true
    LIMIT 1
];

// Step 3: Create the additional recordIds map
Map<String, Id> additionalRecordIds = new Map<String, Id>{
    'termsId' => companyTerms.Id
};

// Step 4: Get the opportunities to process
List<Opportunity> opportunities = [
    SELECT Id FROM Opportunity
    WHERE StageName = 'Closed Won'
    AND HasContract__c = false
    LIMIT 100
];

List<Id> opportunityIds = new List<Id>();
for (Opportunity opp : opportunities) {
    opportunityIds.add(opp.Id);
}

// Step 5: Create the batch job with additional static IDs
BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
    composite.Id,           // Composite_Document__c ID
    opportunityIds,         // List of Opportunity IDs (dynamic)
    'PDF',                 // Output format
    'opportunityId',       // Variable name for batch recordIds
    additionalRecordIds    // Static IDs shared across all records
);

// Step 6: Execute with batch size of 50
Database.executeBatch(batch, 50);
```

**Key Points:**
- The `additionalRecordIds` map contains IDs that are the same for ALL records in the batch
- For each Opportunity, the final recordIds map will contain:
  - `'opportunityId'` → current Opportunity ID (dynamic)
  - `'termsId'` → companyTerms.Id (static)
- This allows each generated document to include both the specific Opportunity data and the standard Terms & Conditions

**Result:** Creates 100 `Generated_Document__c` records, each with access to both the specific Opportunity data and the shared Terms & Conditions data.

---

### Example 3: Multi-Object Composite with Multiple Static References

```apex
// Complex scenario: Invoice document that needs:
// - Dynamic: Account data (one per batch)
// - Static: Company Profile, Legal Disclaimer, Payment Terms

Composite_Document__c composite = [
    SELECT Id FROM Composite_Document__c
    WHERE Name = 'Customer Invoice Package'
    LIMIT 1
];

// Gather all static reference IDs
Company_Profile__c profile = [
    SELECT Id FROM Company_Profile__c
    WHERE Is_Default__c = true LIMIT 1
];

Legal_Disclaimer__c disclaimer = [
    SELECT Id FROM Legal_Disclaimer__c
    WHERE Type__c = 'Invoice' AND IsActive__c = true LIMIT 1
];

Payment_Terms__c paymentTerms = [
    SELECT Id FROM Payment_Terms__c
    WHERE Name = 'Net 30' LIMIT 1
];

// Create additional IDs map with multiple static references
Map<String, Id> additionalRecordIds = new Map<String, Id>{
    'companyProfileId' => profile.Id,
    'disclaimerId' => disclaimer.Id,
    'paymentTermsId' => paymentTerms.Id
};

// Get accounts to invoice
List<Account> accounts = [
    SELECT Id FROM Account
    WHERE BillingStatus__c = 'Ready for Invoice'
    LIMIT 200
];

List<Id> accountIds = new List<Id>();
for (Account acc : accounts) {
    accountIds.add(acc.Id);
}

// Create batch job
BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
    composite.Id,
    accountIds,
    'PDF',
    'accountId',
    additionalRecordIds
);

// Execute with appropriate batch size
Database.executeBatch(batch, 75);
```

**Key Points:**
- You can include as many static references as needed in the `additionalRecordIds` map
- Each generated document will have access to ALL the recordIds (1 dynamic + N static)
- The composite document configuration's junction records should have templates/data providers configured for each namespace ('Account', 'CompanyProfile', 'Disclaimer', 'PaymentTerms')

---

## Best Practices

### 1. Batch Size Selection

Choose batch size based on document complexity:

| Document Type | Recommended Batch Size | Rationale |
|--------------|----------------------|-----------|
| Single Template | 200 | Simple envelope building, minimal heap usage |
| Composite (2-3 namespaces) | 75-100 | Moderate complexity, multiple data providers |
| Composite (4+ namespaces) | 50 | High complexity, multiple SOQL queries per record |
| Composite with Large Data | 25-50 | Large datasets per namespace, high heap usage |

### 2. Composite Document Configuration

Before running a batch job:
- Ensure the Composite_Document__c record has `IsActive__c = true`
- Verify all junction records (Composite_Document_Template__c) are active
- Test the composite configuration with a single record first using `DocgenController.generateComposite()`

### 3. Error Handling

The batch class handles errors gracefully:
- Individual record failures don't stop the entire batch
- Errors are logged in the batch's stateful error list
- Check the finish() method's debug logs for error summaries

```apex
// Monitor batch progress
System.debug([SELECT Status, NumberOfErrors, JobItemsProcessed, TotalJobItems
              FROM AsyncApexJob WHERE Id = :batchJobId]);
```

### 4. Governor Limits

Composite documents execute multiple data providers, which can consume:
- SOQL queries (each namespace may have its own queries)
- Heap size (multi-namespace data structures)
- CPU time (data transformation and merging)

**Recommendations:**
- Use selective SOQL queries in your templates
- Avoid querying large related lists unnecessarily
- Test with production data volumes in a sandbox first

### 5. RequestJSON Truncation

Composite envelopes can be large. The `BatchDocgenEnqueue` class automatically truncates `RequestJSON__c` to 131KB with a `[TRUNCATED]` marker if needed.

- This is for debugging purposes only
- The Node.js poller reconstructs the envelope from the composite configuration
- Truncation does NOT affect document generation

---

## Batch Size Recommendations

### Factors Affecting Batch Size

1. **Number of Namespaces**: More namespaces = more data providers = more processing per record
2. **SOQL Complexity**: Complex queries with joins take longer to execute
3. **Data Volume**: Large datasets in each namespace consume more heap
4. **Apex Data Provider Logic**: Custom Apex providers may have additional overhead

### Recommended Starting Points

Start with these batch sizes and adjust based on monitoring:

```apex
// Simple composite (2 namespaces, simple SOQL)
Database.executeBatch(batch, 100);

// Medium composite (3-4 namespaces, moderate complexity)
Database.executeBatch(batch, 75);

// Complex composite (5+ namespaces, Apex providers, related lists)
Database.executeBatch(batch, 50);

// Very complex (multiple Apex providers, large data transformations)
Database.executeBatch(batch, 25);
```

### Monitoring and Adjusting

If you encounter governor limit errors:
1. Check `AsyncApexJob` records for the specific error
2. Reduce batch size by 25-50%
3. Optimize your SOQL queries and data providers
4. Consider breaking the composite into smaller composites

---

## Troubleshooting

### Problem: "Composite Document not found"

**Cause:** Invalid Composite_Document__c ID or record doesn't exist.

**Solution:**
```apex
// Verify the composite exists
Composite_Document__c composite = [
    SELECT Id, Name, IsActive__c
    FROM Composite_Document__c
    WHERE Id = :compositeDocId
];

System.debug('Composite: ' + composite.Name + ', Active: ' + composite.IsActive__c);
```

### Problem: "Composite Document is not active"

**Cause:** The Composite_Document__c record has `IsActive__c = false`.

**Solution:**
```apex
// Update the composite to active
UPDATE new Composite_Document__c(
    Id = compositeDocId,
    IsActive__c = true
);
```

### Problem: "System.LimitException: Apex heap size too large"

**Cause:** Batch size is too large for the complexity of your composite document.

**Solution:**
1. Reduce batch size significantly (try 25 or 50)
2. Optimize your SOQL queries to select only necessary fields
3. Review Apex data providers for unnecessary data transformations
4. Consider breaking the composite into multiple smaller composites

### Problem: "No Generated_Document__c records created"

**Possible Causes:**
1. Batch job failed silently (check AsyncApexJob)
2. Record IDs list was empty
3. Constructor validation failed

**Solution:**
```apex
// Check batch job status
List<AsyncApexJob> jobs = [
    SELECT Id, Status, NumberOfErrors, ExtendedStatus
    FROM AsyncApexJob
    WHERE ApexClass.Name = 'BatchDocgenEnqueue'
    AND CreatedDate = TODAY
    ORDER BY CreatedDate DESC
    LIMIT 10
];

for (AsyncApexJob job : jobs) {
    System.debug('Job: ' + job.Id + ', Status: ' + job.Status +
                 ', Errors: ' + job.NumberOfErrors);
    if (job.ExtendedStatus != null) {
        System.debug('Error: ' + job.ExtendedStatus);
    }
}
```

### Problem: "Variable 'accountId' not found in composite data"

**Cause:** The `recordIdFieldName` parameter doesn't match what your composite templates expect.

**Solution:**
- Verify the variable name used in your composite templates/data providers
- Ensure you're passing the correct variable name to the constructor
- Variable names are case-sensitive (use 'accountId' not 'AccountId')

### Problem: RequestJSON is too large / getting truncated

**Cause:** Composite envelope exceeds 131KB limit for `RequestJSON__c` field.

**Solution:**
- This is expected for complex composites and does NOT affect generation
- The `[TRUNCATED]` marker indicates truncation occurred
- Node.js poller reconstructs full envelope from composite configuration
- If you need full JSON for debugging, use `DocgenEnvelopeService.buildForComposite()` directly

---

## Additional Resources

- [Composite Documents Playbook](./composite-documents-playbook.md) - Full design and implementation details
- [BatchDocgenEnqueue API Documentation](../force-app/main/default/classes/BatchDocgenEnqueue.cls) - Class reference
- [DocgenEnvelopeService](../force-app/main/default/classes/DocgenEnvelopeService.cls) - Envelope building methods
- [CompositeDocgenDataProvider](../force-app/main/default/classes/CompositeDocgenDataProvider.cls) - Data building logic

---

## Example: Scheduling Recurring Batch Jobs

For recurring composite document generation, use Scheduled Apex:

```apex
global class ScheduledInvoiceGeneration implements Schedulable {

    global void execute(SchedulableContext ctx) {
        // Get composite configuration
        Composite_Document__c composite = [
            SELECT Id FROM Composite_Document__c
            WHERE Name = 'Monthly Invoice Package'
            LIMIT 1
        ];

        // Get accounts ready for invoicing
        List<Account> accounts = [
            SELECT Id FROM Account
            WHERE InvoiceStatus__c = 'Pending'
            AND BillingCycle__c = 'Monthly'
            LIMIT 500
        ];

        if (!accounts.isEmpty()) {
            List<Id> accountIds = new List<Id>();
            for (Account acc : accounts) {
                accountIds.add(acc.Id);
            }

            // Create and execute batch
            BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
                composite.Id,
                accountIds,
                'PDF',
                'accountId'
            );

            Database.executeBatch(batch, 75);
        }
    }
}

// Schedule to run on the 1st of every month at 2 AM
String cronExp = '0 0 2 1 * ?';
String jobId = System.schedule(
    'Monthly Invoice Generation',
    cronExp,
    new ScheduledInvoiceGeneration()
);
```

---

## Summary

**Key Takeaways:**

1. **Use composite batching** when you need to combine data from multiple sources into a single document
2. **Choose appropriate batch sizes** based on composite complexity (25-100 records per chunk)
3. **Include static IDs** when you have shared reference data (like Terms & Conditions)
4. **Monitor batch jobs** through AsyncApexJob records for errors and performance
5. **Test thoroughly** with production-like data volumes before deploying to production
6. **Start conservatively** with smaller batch sizes and increase based on monitoring

For questions or issues, refer to the [Troubleshooting](#troubleshooting) section or consult the technical documentation.
