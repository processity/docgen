# Admin Runbook: Object Configurability Operations

## Table of Contents

1. [Overview](#overview)
2. [Runbook 1: Add New Object Type](#runbook-1-add-new-object-type)
3. [Runbook 2: Deactivate Object Type](#runbook-2-deactivate-object-type)
4. [Runbook 3: Troubleshoot "Object Not Configured" Errors](#runbook-3-troubleshoot-object-not-configured-errors)
5. [Runbook 4: Troubleshoot Permission/FLS Errors](#runbook-4-troubleshoot-permissionfls-errors)
6. [Runbook 5: Validate Object Configuration](#runbook-5-validate-object-configuration)
7. [Runbook 6: Create and Test Templates](#runbook-6-create-and-test-templates)
8. [Common Error Codes](#common-error-codes)
9. [Health Checks](#health-checks)

---

## Overview

### Purpose

This runbook provides **step-by-step operational procedures** for Salesforce Administrators managing the PDF Generation system's object configurability feature.

### When to Use This Runbook

- Adding support for a new Salesforce object (standard or custom)
- Deactivating an object type
- Troubleshooting configuration errors
- Validating system health
- Creating and testing templates

### Prerequisites

To execute these runbooks, you need:
- ✅ **Customize Application** permission
- ✅ **Manage Custom Metadata Types** permission
- ✅ **Modify All Data** or object-specific CRUD permissions
- ✅ **Docgen_User** permission set assigned (for testing)

### Related Documentation

- **[ADMIN_GUIDE.md](./ADMIN_GUIDE.md)** - Detailed configuration guide
- **[Template Authoring Guide](./template-authoring.md)** - Template syntax reference
- **[RUNBOOKS.md](./RUNBOOKS.md)** - DevOps operational runbooks

---

## Runbook 1: Add New Object Type

### Objective

Enable PDF document generation for a new Salesforce object (standard or custom).

### Impact Assessment

- **User Impact:** None (users won't see new object until templates are created)
- **System Impact:** Minimal (metadata-only changes)
- **Rollback Complexity:** Easy (deactivate Custom Metadata record)

### Time Estimate

- **Simple object (no complex relationships):** 15-20 minutes
- **Complex object (with relationships, sub-queries):** 30-45 minutes

### Prerequisites

- [ ] Identify object API name (e.g., "Asset", "Custom_Object__c")
- [ ] Determine if object is standard or custom
- [ ] Verify users have Read access to the object
- [ ] Have sample SOQL query ready (for template configuration)

---

### Procedure

#### Step 1.1: Create Lookup Field on Generated_Document__c

**Time:** 5 minutes

**Actions:**
1. Setup → **Object Manager** → **Generated Document**
2. **Fields & Relationships** → **New**
3. Select **Lookup Relationship** → **Next**
4. **Related To:** Select your object (e.g., Asset)
5. **Field Label:** Object name (e.g., "Asset")
6. **Field Name:** Auto-generated (e.g., "Asset") → results in `Asset__c`
7. **Next** → Leave **Required** unchecked
8. **What to do if lookup record is deleted?** → **Clear the value of this field**
9. **Next** → Grant visibility to System Administrator and relevant profiles
10. **Next** → **Add field to all page layouts**
11. **Save**

**Validation:**
```
✓ Field appears in Object Manager → Generated Document → Fields list
✓ API Name ends with __c (e.g., Asset__c)
```

**Rollback:** Delete the field (Setup → Object Manager → Generated Document → Fields → [Field] → Delete)

---

#### Step 1.2: Create Custom Metadata Record

**Time:** 3 minutes

**Actions:**
1. Setup → **Custom Metadata Types** → **Supported Object** → **Manage Records**
2. **New** button
3. Fill in fields:

   | Field | Value | Example |
   |-------|-------|---------|
   | **Label** | Object display name | `Asset` |
   | **Supported Object Name** | Auto-generated | `Asset` |
   | **Object API Name** | Exact Salesforce API name | `Asset` |
   | **Lookup Field API Name** | Field from Step 1.1 | `Asset__c` |
   | **Is Active** | ✓ Checked | `true` |
   | **Display Order** | Next available (multiples of 10) | `60` |
   | **Description** | Admin notes | `Enables PDF generation for Asset records` |

4. **Save**

**Validation:**
```
✓ Record appears in Supported Object list
✓ Object API Name matches exactly (case-sensitive)
✓ Lookup Field API Name includes __c suffix
✓ Is Active is checked
```

**Rollback:** Edit record → Uncheck **Is Active** → Save

---

#### Step 1.3: Update Permission Set

**Time:** 3 minutes

**Actions:**
1. Setup → **Permission Sets** → **Docgen User**
2. **Object Settings** → **Generated Document** → **Edit**
3. **Field Permissions** section
4. Find your new lookup field (e.g., "Asset")
5. Check **Read Access** ✓
6. Check **Edit Access** ✓
7. **Save**

**Validation:**
```
✓ Field shows "Read" and "Edit" in Field Permissions table
✓ No FLS errors when creating test records
```

**Rollback:** Edit permissions → Uncheck Read/Edit → Save

---

#### Step 1.4: Create Test Template

**Time:** 5-10 minutes

**Actions:**
1. Create simple DOCX template with basic fields
2. Upload to Salesforce Files
3. Copy ContentVersionId (18-character ID starting with '068')
4. Navigate to **Docgen Templates** tab → **New**
5. Fill in:

   | Field | Value |
   |-------|-------|
   | **Template Name** | `Asset Summary` |
   | **Primary Parent** | `Asset` (must match Object API Name) |
   | **Data Source** | `SOQL` |
   | **SOQL** | `SELECT Id, Name, SerialNumber FROM Asset WHERE Id = :recordId` |
   | **Template Content Version ID** | ContentVersionId from Files |

6. **Save**

**Validation:**
```
✓ Template saves without errors
✓ PrimaryParent__c = 'Asset'
✓ SOQL query is valid
```

**Rollback:** Delete template record

---

#### Step 1.5: Test Document Generation

**Time:** 5 minutes

**Actions:**
1. Create test record for your object (e.g., test Asset)
2. Generate document:

   **Option A - Apex (Developer Console):**
   ```apex
   Asset testAsset = [SELECT Id FROM Asset LIMIT 1];
   Docgen_Template__c template = [
       SELECT Id
       FROM Docgen_Template__c
       WHERE Name = 'Asset Summary'
       LIMIT 1
   ];

   Test.startTest();
   String downloadUrl = DocgenController.generate(
       template.Id,
       testAsset.Id,
       'PDF'
   );
   Test.stopTest();

   System.debug('Download URL: ' + downloadUrl);
   ```

   **Option B - UI (if LWC deployed):**
   - Navigate to Asset record
   - Click "Generate Document" button
   - Select template
   - Click "Generate"

3. Verify Generated_Document__c record created
4. Check lookup field (e.g., Asset__c) is populated
5. Download and open PDF

**Validation:**
```
✓ Generated_Document__c record exists
✓ Asset__c lookup populated with correct ID
✓ Status__c = "SUCCEEDED"
✓ OutputFileId__c has ContentVersionId
✓ PDF downloads and opens successfully
```

**Rollback:** Not needed (test data can be deleted)

---

### Success Criteria

- [x] Lookup field created on Generated_Document__c
- [x] Custom Metadata record created and active
- [x] Permission set grants FLS on new field
- [x] Test template created
- [x] Document generation successful
- [x] Generated_Document__c lookup populated

### Rollback Plan

If issues occur:
1. **Deactivate** Custom Metadata record (Is Active = false)
2. Test existing objects still work
3. Debug issue before re-activating
4. If needed, delete lookup field (last resort)

---

## Runbook 2: Deactivate Object Type

### Objective

Temporarily or permanently disable document generation for an object type.

### Impact Assessment

- **User Impact:** Users can't generate new documents for this object
- **Existing Documents:** Remain unchanged and accessible
- **Templates:** Remain but can't be used
- **System Impact:** Minimal

### Time Estimate

**2 minutes**

### Prerequisites

- [ ] Confirm object should be deactivated
- [ ] Notify users if they're actively using this object type
- [ ] Verify no critical processes depend on this object

---

### Procedure

#### Step 2.1: Deactivate Custom Metadata Record

**Actions:**
1. Setup → **Custom Metadata Types** → **Supported Object** → **Manage Records**
2. Find object record (e.g., "Asset")
3. Click **Edit**
4. **Uncheck** **Is Active**
5. **Save**

**Validation:**
```
✓ Is Active = false
✓ Record still exists (not deleted)
✓ Other objects still active
```

---

#### Step 2.2: Test Error Handling

**Actions:**
1. Attempt to generate document from deactivated object type
2. Observe error message

**Expected Behavior:**
```
Error: "Object type 'Asset' is not configured for document generation.
Contact your administrator to enable this object type."
```

**Validation:**
```
✓ Clear error message displayed
✓ No system errors in debug logs
✓ Other objects still work
```

---

### Success Criteria

- [x] Custom Metadata record deactivated (Is Active = false)
- [x] Error message displays correctly when attempted
- [x] Existing Generated_Document__c records unchanged
- [x] Other object types unaffected

### Rollback Plan

To re-activate:
1. Edit Custom Metadata record
2. **Check** **Is Active**
3. Save
4. Test document generation

---

## Runbook 3: Troubleshoot "Object Not Configured" Errors

### Objective

Diagnose and resolve "Object type 'X' is not configured for document generation" errors.

### Impact Assessment

- **User Impact:** Users blocked from generating documents
- **System Impact:** None (error is informational)

### Time Estimate

**5-10 minutes**

---

### Diagnostic Steps

#### Step 3.1: Verify Custom Metadata Record Exists

**Actions:**
1. Setup → **Custom Metadata Types** → **Supported Object** → **Manage Records**
2. Search for object name (e.g., "Asset")

**If record doesn't exist:**
→ **Root Cause:** Object not configured
→ **Solution:** Follow [Runbook 1: Add New Object Type](#runbook-1-add-new-object-type)

**If record exists:**
→ Proceed to Step 3.2

---

#### Step 3.2: Check Is Active Flag

**Actions:**
1. Open Custom Metadata record
2. Check **Is Active** field

**If Is Active = false:**
→ **Root Cause:** Object deactivated
→ **Solution:**
   - Edit record
   - Check **Is Active**
   - Save

**If Is Active = true:**
→ Proceed to Step 3.3

---

#### Step 3.3: Verify Object API Name

**Actions:**
1. Check Custom Metadata record → **Object API Name** field
2. Compare with actual Salesforce object API name:
   - Setup → Object Manager → Find object → Check API Name

**Common Mistakes:**
- ❌ `asset` (lowercase) → Should be `Asset`
- ❌ `Contact` (standard) → Should be `Contact` (correct)
- ❌ `Custom_Object` (missing __c) → Should be `Custom_Object__c`

**If mismatch found:**
→ **Root Cause:** Incorrect API name (case-sensitive)
→ **Solution:**
   - Edit Custom Metadata record
   - Update **Object API Name** to exact match
   - Save

**If API name is correct:**
→ Proceed to Step 3.4

---

#### Step 3.4: Check Cache Issues (Rare)

**Actions:**
1. Open Developer Console
2. Execute Anonymous:
   ```apex
   // Clear cache (test environment only)
   DocgenObjectConfigService.configCache = null;

   // Re-test
   DocgenObjectConfigService.validateObjectSupported('Asset');
   System.debug('Validation passed');
   ```

**If error persists:**
→ **Root Cause:** System issue
→ **Escalation:** Contact system administrator

---

### Resolution Checklist

- [ ] Custom Metadata record exists
- [ ] Is Active = true
- [ ] Object API Name matches exactly (case-sensitive)
- [ ] Lookup Field API Name is correct
- [ ] Cache cleared (if applicable)
- [ ] Test document generation successful

### Prevention

- Use exact API names from Object Manager
- Test configuration in Sandbox before production
- Document object API names for reference

---

## Runbook 4: Troubleshoot Permission/FLS Errors

### Objective

Resolve "Insufficient privileges" or field-level security errors.

### Impact Assessment

- **User Impact:** Users blocked from generating documents
- **System Impact:** None (permission issue)

### Time Estimate

**5-10 minutes**

---

### Diagnostic Steps

#### Step 4.1: Verify User Has Docgen_User Permission Set

**Actions:**
1. Setup → **Users** → Find affected user
2. Click username → **Permission Set Assignments**
3. Check if **Docgen User** is assigned

**If not assigned:**
→ **Root Cause:** Missing permission set
→ **Solution:**
   - **Permission Set Assignments** → **Edit Assignments**
   - Add **Docgen User**
   - Save

**If assigned:**
→ Proceed to Step 4.2

---

#### Step 4.2: Check Field-Level Security on Lookup Field

**Actions:**
1. Setup → **Permission Sets** → **Docgen User**
2. **Object Settings** → **Generated Document**
3. Find your lookup field (e.g., Asset__c)

**If field not listed or both Read/Edit unchecked:**
→ **Root Cause:** Missing FLS
→ **Solution:**
   - Click **Edit**
   - Find field in **Field Permissions** section
   - Check **Read Access** ✓
   - Check **Edit Access** ✓
   - Save

**If FLS is correct:**
→ Proceed to Step 4.3

---

#### Step 4.3: Verify Object-Level Permissions

**Actions:**
1. Check user has Read access to source object (e.g., Asset)
2. Setup → **Users** → [User] → **Permission Set Assignments**
3. Review permission sets for object access

**Common Issues:**
- User can't read Asset object → Need "Read" on Asset
- User can't read Generated_Document__c → Should have Docgen_User permission set

**If object access missing:**
→ **Root Cause:** Missing object-level permission
→ **Solution:** Grant Read access to object via permission set or profile

---

### Resolution Checklist

- [ ] User has Docgen_User permission set assigned
- [ ] FLS granted on lookup field (Read + Edit)
- [ ] User has Read access to source object
- [ ] User has Read/Create access to Generated_Document__c
- [ ] Test document generation successful

---

## Runbook 5: Validate Object Configuration

### Objective

Verify that an object is correctly configured for document generation.

### Impact Assessment

- **User Impact:** None (validation only)
- **System Impact:** None

### Time Estimate

**5 minutes**

---

### Validation Checklist

#### 5.1 Custom Metadata Record

**Check:**
- [ ] Record exists in Supported_Object__mdt
- [ ] **Label** is user-friendly (e.g., "Asset")
- [ ] **Object API Name** matches Salesforce object exactly
- [ ] **Lookup Field API Name** ends with `__c` (e.g., `Asset__c`)
- [ ] **Is Active** = true
- [ ] **Display Order** is unique (multiples of 10)

**Verification Query:**
```apex
List<Supported_Object__mdt> configs = [
    SELECT Label, Object_API_Name__c, Lookup_Field_API_Name__c, Is_Active__c
    FROM Supported_Object__mdt
    WHERE Object_API_Name__c = 'Asset'
];

for (Supported_Object__mdt config : configs) {
    System.debug('Object: ' + config.Object_API_Name__c);
    System.debug('Lookup Field: ' + config.Lookup_Field_API_Name__c);
    System.debug('Active: ' + config.Is_Active__c);
}
```

---

#### 5.2 Lookup Field Exists

**Check:**
- [ ] Field exists on Generated_Document__c object
- [ ] Field API name matches Custom Metadata configuration
- [ ] Field type is Lookup to correct object
- [ ] Delete behavior is "Clear this value" (not cascade delete)

**Verification:**
```apex
Schema.DescribeFieldResult fieldDescribe =
    Generated_Document__c.Asset__c.getDescribe();

System.debug('Field Label: ' + fieldDescribe.getLabel());
System.debug('Field Type: ' + fieldDescribe.getType());
System.debug('References: ' + fieldDescribe.getReferenceTo());
```

---

#### 5.3 Permission Set Grants FLS

**Check:**
- [ ] Docgen_User permission set exists
- [ ] FLS granted on lookup field (Read + Edit)
- [ ] No conflicts with other permission sets

**Verification:**
1. Setup → Permission Sets → Docgen User → Object Settings → Generated Document
2. Verify field shows "Read" and "Edit"

---

#### 5.4 End-to-End Test

**Check:**
- [ ] Create test record for object
- [ ] Create test template
- [ ] Generate document
- [ ] Verify lookup field populated
- [ ] PDF downloads successfully

**Test Script:**
```apex
// Create test record
Asset testAsset = new Asset(
    Name = 'Test Asset',
    SerialNumber = 'TEST-001',
    Status = 'Installed'
);
insert testAsset;

// Create test template
Docgen_Template__c template = new Docgen_Template__c(
    Name = 'Asset Validation Test',
    PrimaryParent__c = 'Asset',
    DataSource__c = 'SOQL',
    SOQL__c = 'SELECT Id, Name FROM Asset WHERE Id = :recordId',
    TemplateContentVersionId__c = '068XXXXXXXXXXXX' // Replace with actual
);
insert template;

// Generate document
Test.startTest();
String result = DocgenController.generate(template.Id, testAsset.Id, 'PDF');
Test.stopTest();

// Verify
Generated_Document__c doc = [
    SELECT Asset__c, Status__c
    FROM Generated_Document__c
    WHERE Asset__c = :testAsset.Id
];

System.assertEquals(testAsset.Id, doc.Asset__c, 'Lookup should be populated');
System.assertEquals('SUCCEEDED', doc.Status__c, 'Generation should succeed');
```

---

### Success Criteria

All validation checks pass:
- ✅ Custom Metadata configured correctly
- ✅ Lookup field exists and configured properly
- ✅ Permission set grants FLS
- ✅ End-to-end test successful

---

## Runbook 6: Create and Test Templates

### Objective

Create a document template for a new object type and verify it works correctly.

### Impact Assessment

- **User Impact:** None until template is activated
- **System Impact:** Minimal

### Time Estimate

**20-30 minutes** (including template design)

---

### Procedure

#### Step 6.1: Design Template Content

**Planning:**
1. Identify required fields from object
2. Determine relationships to include (parent/child)
3. Plan conditional sections
4. Sketch layout (header, body, footer)

**Field Path Reference:**
- Simple fields: `{{Asset.Name}}`, `{{Asset.SerialNumber}}`
- Formatted values: `{{Asset.PurchaseDate__formatted}}`, `{{Asset.Price__formatted}}`
- Related objects: `{{Asset.Account.Name}}`, `{{Asset.Product2.ProductCode}}`
- Conditionals: `{{#if Asset.Status == 'Active'}}...{{/if}}`
- Child relationships: `{{#each Asset.MaintenanceRecords}}...{{/each}}`

**Sample Template Outline:**
```
┌─────────────────────────────────────┐
│ HEADER                              │
│ Asset Summary                       │
│ Generated: {{GeneratedDate}}        │
└─────────────────────────────────────┘

Asset Information
Name: {{Asset.Name}}
Serial Number: {{Asset.SerialNumber}}
Status: {{Asset.Status}}
Purchase Date: {{Asset.PurchaseDate__formatted}}

Account Information
{{#if Asset.Account.Name}}
Account: {{Asset.Account.Name}}
City: {{Asset.Account.BillingCity}}
{{/if}}

┌─────────────────────────────────────┐
│ FOOTER                              │
│ Page 1 of 1                         │
└─────────────────────────────────────┘
```

---

#### Step 6.2: Create DOCX Template in Microsoft Word

**Actions:**
1. Open Microsoft Word
2. Create document with your layout
3. Add template tags using `{{FieldPath}}` syntax
4. Format text (fonts, sizes, colors)
5. Add tables for repeating data
6. Save as .docx file

**Tips:**
- Use triple braces for images: `{{{Asset.ImageURL}}}`
- Place `{{#each}}` and `{{/each}}` in same table cell
- Test conditionals with both true and false data
- Keep formatting simple for first version

---

#### Step 6.3: Write SOQL Query

**Actions:**
1. Identify all fields used in template
2. Write SOQL query including all fields
3. Test query in Developer Console

**Example:**
```sql
SELECT Id, Name, SerialNumber, Status, PurchaseDate, Price,
       Account.Name, Account.BillingCity,
       Product2.Name, Product2.ProductCode,
       (SELECT Subject, CompletedDate FROM MaintenanceRecords ORDER BY CompletedDate DESC)
FROM Asset
WHERE Id = :recordId
```

**Validation:**
```apex
// Test query
Asset testAsset = [SELECT Id FROM Asset LIMIT 1];

// Replace :recordId with actual ID for testing
String query = 'SELECT Id, Name, SerialNumber FROM Asset WHERE Id = \'' + testAsset.Id + '\'';
Asset result = Database.query(query);

System.debug('Query result: ' + result);
```

---

#### Step 6.4: Upload Template to Salesforce Files

**Actions:**
1. Navigate to **Files** tab
2. Click **Upload Files**
3. Select your .docx file
4. Upload completes → Click file name
5. In URL bar, find ContentVersionId (18-char ID starting with '068')
6. Copy ContentVersionId

**Example URL:**
```
https://yourorg.lightning.force.com/lightning/r/ContentDocument/069.../view?0.source=aloha
                                                                   ^^^
                                                            ContentDocumentId

// To get ContentVersionId:
// Click file → Details → Related tab → Content Versions → Click version → Copy ID from URL
```

---

#### Step 6.5: Create Docgen Template Record

**Actions:**
1. **Docgen Templates** tab → **New**
2. Fill in:

   | Field | Value |
   |-------|-------|
   | **Template Name** | `Asset Summary` |
   | **Primary Parent** | `Asset` (must match Object API Name) |
   | **Data Source** | `SOQL` |
   | **SOQL** | Paste query from Step 6.3 |
   | **Template Content Version ID** | Paste ContentVersionId from Step 6.4 |
   | **Store Merged DOCX** | Unchecked (usually) |
   | **Return DOCX to Browser** | Unchecked (PDF default) |

3. **Save**

---

#### Step 6.6: Test Template

**Actions:**
1. Create test record with realistic data
2. Generate document
3. Download PDF and review

**Test Cases:**
- ✅ All fields populated correctly
- ✅ Formatted values display properly (dates, currency)
- ✅ Conditional sections work (both true and false cases)
- ✅ Related object data displays
- ✅ Child relationships iterate correctly
- ✅ Layout is professional and readable

**Debugging:**
```apex
// If merge fails, check data structure
Asset testAsset = [SELECT Id FROM Asset LIMIT 1];

// Execute template's SOQL query
String query = 'SELECT Id, Name, SerialNumber FROM Asset WHERE Id = :testAsset.Id';
Asset result = Database.query(query);

// Verify field paths
System.debug('Name: ' + result.Name);
System.debug('SerialNumber: ' + result.SerialNumber);
```

---

### Success Criteria

- [x] Template designed with all required fields
- [x] SOQL query tested and valid
- [x] DOCX template uploaded to Files
- [x] Docgen Template record created
- [x] Test document generated successfully
- [x] PDF displays all data correctly
- [x] Formatting is professional

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Field not rendering | Not in SOQL query | Add field to SELECT clause |
| "Invalid field path" error | Typo in template tag | Match exact API name from SOQL |
| Image not displaying | Not using triple braces | Change `{{Image}}` to `{{{Image}}}` |
| Loop not working | Tags not in same cell | Move `{{#each}}` and `{{/each}}` to same table cell |
| Formatting wrong | Using raw value | Use `__formatted` suffix |

---

## Common Error Codes

### Error Code Reference

| Error Message | Code | Cause | Resolution | Runbook |
|---------------|------|-------|------------|---------|
| "Object type 'X' is not configured for document generation" | OBJECT_NOT_CONFIGURED | No Custom Metadata record or Is Active = false | Activate or create Custom Metadata record | [Runbook 3](#runbook-3-troubleshoot-object-not-configured-errors) |
| "Field 'X__c' does not exist on Generated_Document__c" | FIELD_NOT_FOUND | Lookup field name mismatch | Update Custom Metadata to match actual field name | [Runbook 5](#runbook-5-validate-object-configuration) |
| "Insufficient privileges" | INSUFFICIENT_FLS | Missing field-level security | Grant FLS via Docgen_User permission set | [Runbook 4](#runbook-4-troubleshoot-permissionfls-errors) |
| "Template not found" | TEMPLATE_NOT_FOUND | Invalid ContentVersionId | Re-upload template and update ContentVersionId | [Runbook 6](#runbook-6-create-and-test-templates) |
| "Invalid SOQL query" | INVALID_SOQL | Syntax error in template's SOQL | Fix SOQL query in template record | [Runbook 6](#runbook-6-create-and-test-templates) |
| "Merge failed: Invalid field path" | INVALID_FIELD_PATH | Template references field not in SOQL | Add field to SOQL or fix template tag | [Runbook 6](#runbook-6-create-and-test-templates) |

---

## Health Checks

### Daily Health Check (5 minutes)

**Monitor Generated Documents:**
1. Navigate to **Generated Documents** tab
2. Filter: **Status = FAILED**, **Created Date = TODAY**
3. Review failures:
   - 0-2 failures: ✅ Normal (transient errors)
   - 3-10 failures: ⚠️ Investigate common patterns
   - 10+ failures: 🚨 System issue - escalate

**Quick Validation:**
```apex
// Count failures today
Integer failureCount = [
    SELECT COUNT()
    FROM Generated_Document__c
    WHERE Status__c = 'FAILED'
    AND CreatedDate = TODAY
];

System.debug('Failures today: ' + failureCount);
```

---

### Weekly Health Check (15 minutes)

**Review Configuration:**
1. Setup → Custom Metadata Types → Supported Object → Manage Records
2. Verify:
   - [ ] All expected objects are active
   - [ ] No duplicate Display Orders
   - [ ] API names are correct
   - [ ] No orphaned inactive records (consider deleting)

**Review Templates:**
1. Docgen Templates tab → View All
2. Check for:
   - [ ] Inactive templates (delete if obsolete)
   - [ ] Templates with broken ContentVersionId references
   - [ ] Templates with SOQL errors

**Performance Check:**
```apex
// Average generation time (last 7 days)
AggregateResult[] results = [
    SELECT AVG(Duration__c) avgDuration
    FROM Generated_Document__c
    WHERE CreatedDate = LAST_N_DAYS:7
    AND Status__c = 'SUCCEEDED'
];

System.debug('Average duration: ' + results[0].get('avgDuration'));
```

---

### Monthly Health Check (30 minutes)

**Audit Object Configuration:**
1. Review all Supported Object records
2. Identify unused objects (no documents generated in 30 days)
3. Consider deactivating or deleting unused configurations

**Template Usage Analysis:**
```apex
// Templates by usage (last 30 days)
AggregateResult[] results = [
    SELECT Template__r.Name tmplName, COUNT(Id) uses
    FROM Generated_Document__c
    WHERE CreatedDate = LAST_N_DAYS:30
    GROUP BY Template__r.Name
    ORDER BY COUNT(Id) DESC
];

for (AggregateResult ar : results) {
    System.debug(ar.get('tmplName') + ': ' + ar.get('uses') + ' uses');
}
```

**User Adoption:**
```apex
// Users generating documents (last 30 days)
Integer userCount = [
    SELECT COUNT_DISTINCT(RequestedBy__c)
    FROM Generated_Document__c
    WHERE CreatedDate = LAST_N_DAYS:30
][0].expr0;

System.debug('Active users: ' + userCount);
```

---

## Support Resources

### Documentation

- **[ADMIN_GUIDE.md](./ADMIN_GUIDE.md)** - Configuration guide
- **[Template Authoring Guide](./template-authoring.md)** - Template syntax
- **[Field Path Conventions](./field-path-conventions.md)** - Data structure reference
- **[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)** - Upgrade guide

### Troubleshooting

- Check error message first (includes remediation guidance)
- Review [Common Error Codes](#common-error-codes) table
- Use appropriate runbook for issue type
- Check debug logs for detailed error information

### Escalation

For issues not resolved by runbooks:
1. Gather diagnostics (error message, object type, steps to reproduce)
2. Check GitHub Issues: https://github.com/bigmantra/docgen/issues
3. Contact system administrator or integrator
4. Include Correlation ID from error message (if available)

---

**Last Updated:** 2025-11-17 (T-11 Implementation)
**Document Version:** 1.0
**Audience:** Salesforce Administrators
