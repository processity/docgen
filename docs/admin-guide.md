# Admin Configuration Guide: Object Configurability

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start: Adding a New Object](#quick-start-adding-a-new-object)
4. [Step-by-Step: Adding Asset Object Support](#step-by-step-adding-asset-object-support)
5. [Creating Templates for New Objects](#creating-templates-for-new-objects)
6. [Deactivating an Object](#deactivating-an-object)
7. [Troubleshooting](#troubleshooting)
8. [Frequently Asked Questions](#frequently-asked-questions)

---

## Overview

### What is Object Configurability?

The Salesforce PDF Generation system now supports **any Salesforce object** (standard or custom) without requiring code changes. As a Salesforce Admin, you can enable document generation for new objects by configuring metadata records and creating lookup fields.

### What You Can Do

- ✅ Enable document generation for standard objects (Contact, Lead, Asset, Product, etc.)
- ✅ Enable document generation for custom objects (Custom__c)
- ✅ Create templates specific to each object type
- ✅ Deactivate objects when no longer needed
- ✅ All configuration done through Salesforce Setup UI

### Pre-Configured Objects

The system comes pre-configured for these objects:

| Object | Lookup Field | Display Order | Status |
|--------|--------------|---------------|--------|
| Account | Account__c | 10 | ✅ Active |
| Opportunity | Opportunity__c | 20 | ✅ Active |
| Case | Case__c | 30 | ✅ Active |
| Contact | Contact__c | 40 | ✅ Active |
| Lead | Lead__c | 50 | ✅ Active |

---

## Prerequisites

### Required Permissions

To configure new objects, you need:

- **Customize Application** - To create custom fields and metadata
- **Manage Custom Metadata Types** - To create Supported Object configurations
- **Modify All Data** (or object-specific permissions) - To create test records

### Recommended Knowledge

- Familiarity with Salesforce Setup UI
- Understanding of object relationships and field types
- Basic knowledge of SOQL (for template configuration)

### System Requirements

- Salesforce org with the Docgen package deployed
- Access to Setup menu
- Docgen_User permission set assigned (for testing)

---

## Quick Start: Adding a New Object

**Time Required:** ~15-20 minutes

```
┌─────────────────────────────────────┐
│ 1. Create lookup field              │
│    Generated_Document__c.Asset__c   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ 2. Create Custom Metadata record    │
│    Supported_Object__mdt.Asset      │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ 3. Update permission set            │
│    Grant FLS on Asset__c field      │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ 4. Create template                  │
│    PrimaryParent__c = 'Asset'       │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ 5. Test document generation         │
│    Generate PDF from Asset record   │
└─────────────────────────────────────┘
```

---

## Step-by-Step: Adding Asset Object Support

This walkthrough uses **Asset** as an example. The same steps apply to any standard or custom object.

### Step 1: Create Lookup Field on Generated_Document__c

**Goal:** Create a lookup field to link generated documents to Asset records.

#### 1.1 Navigate to Object Manager

1. Click **Setup** (gear icon in top-right)
2. In Quick Find, type **Object Manager**
3. Click **Object Manager**
4. Find and click **Generated Document** (API Name: `Generated_Document__c`)

#### 1.2 Create Lookup Field

1. Click **Fields & Relationships** tab
2. Click **New** button
3. Select **Lookup Relationship**
4. Click **Next**

#### 1.3 Configure Lookup Field

**Field Configuration:**
- **Related To:** Asset
- **Field Label:** Asset
- **Field Name:** Asset (will auto-generate as `Asset__c`)
- **Description:** Links this generated document to the Asset record

Click **Next**

#### 1.4 Set Field-Level Security

**Recommended Settings:**
- **Required:** Unchecked (documents can be for other objects)
- **What to do if lookup record is deleted?:** Clear the value of this field

Click **Next**

#### 1.5 Grant Field-Level Security

Select **Visible** for:
- ✅ System Administrator
- ✅ Any custom profiles that use document generation

Click **Next**

#### 1.6 Add to Page Layouts

Select **Add field to all page layouts**

Click **Save**

✅ **Validation:** You should see `Asset__c` in the Fields list for Generated_Document__c

---

### Step 2: Create Custom Metadata Record

**Goal:** Register Asset as a supported object in the system configuration.

#### 2.1 Navigate to Custom Metadata Types

1. In Setup, Quick Find: **Custom Metadata Types**
2. Click **Custom Metadata Types**
3. Find **Supported Object** in the list
4. Click **Manage Records** next to Supported Object

#### 2.2 Create New Record

1. Click **New** button
2. Fill in the fields:

**Label:** `Asset`
- This is the display name shown to admins

**Supported Object Name:** `Asset`
- Auto-generated from Label (can't edit after save)

**Object API Name:** `Asset`
- **IMPORTANT:** Must match exact Salesforce API name
- For custom objects, include `__c` (e.g., `Custom_Asset__c`)

**Lookup Field API Name:** `Asset__c`
- **IMPORTANT:** Must match the field you created in Step 1
- Include the `__c` suffix

**Is Active:** ✅ Checked
- Determines if this object is available for document generation

**Display Order:** `60`
- Controls sort order in picklists
- Existing objects use 10, 20, 30, 40, 50
- Use multiples of 10 to allow insertions

**Description:** `Enables document generation for Asset records`
- Optional: Admin notes about this configuration

#### 2.3 Save Record

Click **Save**

✅ **Validation:** You should see the new "Asset" record in the Supported Object list

---

### Step 3: Update Permission Set

**Goal:** Grant field-level security on the new lookup field.

#### 3.1 Navigate to Permission Sets

1. In Setup, Quick Find: **Permission Sets**
2. Click **Permission Sets**
3. Find and click **Docgen User** (API Name: `Docgen_User`)

#### 3.2 Grant Field Permissions

1. Click **Object Settings**
2. Find and click **Generated Document**
3. Click **Edit**
4. Scroll to **Field Permissions** section
5. Find **Asset** field
6. Check both boxes:
   - ✅ Read Access
   - ✅ Edit Access
7. Click **Save**

✅ **Validation:** Asset field should show "Read" and "Edit" in the Field Permissions list

---

### Step 4: Create Template for Asset

**Goal:** Create a document template that generates PDFs from Asset records.

#### 4.1 Navigate to Docgen Templates

1. In App Launcher, search for **Docgen Templates**
2. Click **Docgen Templates** tab
3. Click **New** button

#### 4.2 Configure Template Settings

**Template Name:** `Asset Summary`

**Primary Parent:** `Asset`
- **IMPORTANT:** Type "Asset" exactly as configured in Custom Metadata
- This dropdown allows any value, but validation happens at runtime

**Data Source:** `SOQL`
- Standard option for most templates

**SOQL Query:**
```sql
SELECT Id, Name, SerialNumber, Status, PurchaseDate, Price,
       Account.Name, Account.BillingCity,
       Product2.Name, Product2.ProductCode
FROM Asset
WHERE Id = :recordId
```

**Notes:**
- `:recordId` is automatically bound to the current record
- Include related objects using dot notation (Account.Name)
- Apex will pre-format currency/date fields with `__formatted` suffix

**Template Content Version ID:**
- Upload your template DOCX file to Files
- Get the ContentVersionId (18-character ID)
- Paste it here
- See "Creating Templates" section below for template syntax

**Store Merged DOCX:** Unchecked (usually)
**Return DOCX to Browser:** Unchecked (usually - returns PDF)

#### 4.3 Save Template

Click **Save**

✅ **Validation:** Template should appear in Docgen Templates list

---

### Step 5: Test Document Generation

**Goal:** Verify that document generation works for Asset records.

#### 5.1 Create Test Asset

1. Navigate to **Assets** tab
2. Create a test Asset record with sample data
3. Save the record

#### 5.2 Generate Document

**Option A: Using LWC Button (if deployed to page layout)**
1. On the Asset record page, click **Generate Document** button
2. Select your "Asset Summary" template
3. Click **Generate**
4. System should open PDF in new tab

**Option B: Using Apex Controller (Developer Console)**
```apex
// Get test Asset
Asset testAsset = [SELECT Id FROM Asset LIMIT 1];

// Get template
Docgen_Template__c template = [
    SELECT Id
    FROM Docgen_Template__c
    WHERE Name = 'Asset Summary'
    LIMIT 1
];

// Generate document
String downloadUrl = DocgenController.generate(
    template.Id,
    testAsset.Id,
    'PDF'
);

System.debug('Download URL: ' + downloadUrl);
```

#### 5.3 Verify Generated Document Record

1. Navigate to **Generated Documents** tab
2. Find the newly created record
3. Verify fields:
   - **Asset__c:** Should link to your test Asset
   - **Status__c:** Should be "SUCCEEDED" (or "PROCESSING" briefly)
   - **Output File Id__c:** Should have a ContentVersionId

✅ **Validation:** Document generated successfully, PDF opens correctly

---

## Creating Templates for New Objects

### Template Basics

Templates are Microsoft Word (.docx) files with special tags that get replaced with data from Salesforce.

### Field Syntax

**Simple Fields:**
```
Asset Name: {{Asset.Name}}
Serial Number: {{Asset.SerialNumber}}
Status: {{Asset.Status}}
```

**Formatted Values:**
```
Purchase Price: {{Asset.Price__formatted}}
Purchase Date: {{Asset.PurchaseDate__formatted}}
```

**Related Objects:**
```
Account: {{Asset.Account.Name}}
Product: {{Asset.Product2.Name}}
```

**Conditional Sections:**
```
{{#if Asset.Status == 'Active'}}
  This asset is currently active.
{{else}}
  This asset is inactive.
{{/if}}
```

**Child Relationships (if SOQL includes sub-query):**
```
Maintenance Records:
{{#each Asset.MaintenanceRecords}}
  - {{Subject}} on {{CompletedDate__formatted}}
{{/each}}
```

### Complete Template Example

See **samples/templates/Asset-Template-Spec.md** for a complete example specification.

### Advanced Topics

For complete template authoring guide, see:
- **[Template Authoring Guide](./template-authoring.md)** - Full syntax reference
- **[Field Path Conventions](./field-path-conventions.md)** - Data structure guide

---

## Deactivating an Object

If you need to temporarily or permanently disable document generation for an object:

### Step 1: Deactivate Custom Metadata Record

1. Setup → **Custom Metadata Types**
2. Click **Manage Records** next to **Supported Object**
3. Find the object record (e.g., "Asset")
4. Click **Edit**
5. Uncheck **Is Active**
6. Click **Save**

### Step 2: Verify Behavior

After deactivating:
- ✅ Existing templates still exist but can't be used
- ✅ Existing Generated Document records remain unchanged
- ✅ New document generation attempts will fail with error:
  ```
  Object type 'Asset' is not configured for document generation.
  Contact your administrator to enable this object type.
  ```

### Step 3: Re-activate (if needed)

Simply edit the Custom Metadata record and check **Is Active** again.

**Note:** You do NOT need to delete the lookup field or permission set grants. Deactivating the Custom Metadata record is sufficient.

---

## Troubleshooting

### Error: "Object type 'Asset' is not configured for document generation"

**Cause:** No Custom Metadata record exists, or it's marked inactive.

**Solution:**
1. Navigate to Setup → Custom Metadata Types → Supported Object → Manage Records
2. Verify record exists for "Asset"
3. Verify **Is Active** is checked
4. Verify **Object API Name** matches exactly (case-sensitive)

---

### Error: "Field 'Asset__c' does not exist"

**Cause:** Lookup field name in Custom Metadata doesn't match actual field.

**Solution:**
1. Check Custom Metadata record → **Lookup Field API Name**
2. Check actual field on Generated_Document__c object
3. Verify they match exactly (including `__c` suffix)
4. Update Custom Metadata record if needed

---

### Error: "Insufficient privileges"

**Cause:** User doesn't have field-level security on new lookup field.

**Solution:**
1. Setup → Permission Sets → Docgen User
2. Object Settings → Generated Document → Edit
3. Grant Read and Edit access to the lookup field (e.g., Asset__c)
4. Save changes
5. Verify user has Docgen User permission set assigned

---

### Document Generation Works, But Lookup Field is Null

**Cause:** Dynamic lookup assignment failed (rare - usually a bug).

**Solution:**
1. Verify object type spelling in Custom Metadata (Object API Name)
2. Check debug logs for errors during document creation
3. Test with a simple object (like Contact) to isolate issue
4. Contact system administrator if issue persists

---

### Template Merge Fails with "Invalid field path"

**Cause:** Template references a field not included in SOQL query.

**Solution:**
1. Open the Docgen Template record
2. Review the SOQL query
3. Ensure all fields used in template are in SELECT clause
4. For related fields, use dot notation: `Account.Name`, `Product2.ProductCode`
5. Save template and retry

**Example:**
```sql
-- Template uses {{Asset.Account.BillingCity}}
-- SOQL must include:
SELECT Id, Name, Account.Name, Account.BillingCity
FROM Asset
WHERE Id = :recordId
```

---

### Template Upload Issues

**Cause:** ContentVersionId is incorrect or template file is corrupt.

**Solution:**
1. Upload fresh DOCX file to Salesforce Files
2. Open file detail page
3. Copy the ContentVersionId from URL (18-character ID starting with '068')
4. Paste into Template Content Version ID field
5. Ensure DOCX file was created in Microsoft Word (not Google Docs converted)

---

## Frequently Asked Questions

### Q: Can I add custom objects?

**A:** Yes! Follow the same steps. For custom objects:
- Use full API name including `__c` (e.g., `Custom_Asset__c`)
- Lookup field will be `Custom_Asset__c` → `Custom_Asset__r`
- Ensure users have Read access to the custom object

---

### Q: Do I need developer help to add a new object?

**A:** **No!** As a Salesforce Admin with appropriate permissions, you can complete all steps through the Setup UI. No code deployment is required.

---

### Q: What happens to existing documents if I deactivate an object?

**A:** Existing Generated_Document__c records remain unchanged. Only NEW document generation attempts will fail. You can re-activate the object anytime to resume generation.

---

### Q: Can I support multiple custom objects?

**A:** Yes! Create a separate Custom Metadata record and lookup field for each object. The system supports unlimited object types.

---

### Q: How do I know which objects are currently supported?

**A:** Setup → Custom Metadata Types → Supported Object → Manage Records. Any record with **Is Active = true** is supported.

---

### Q: Can I change the lookup field name after creation?

**A:** Not recommended. If you must:
1. Create new lookup field with desired name
2. Update Custom Metadata record to reference new field
3. Test thoroughly
4. You can delete old field after migration

---

### Q: What if my SOQL query is complex (sub-queries, aggregates)?

**A:** The system supports any valid SOQL query. Complex queries work fine:
```sql
SELECT Id, Name,
       (SELECT Subject, CompletedDate FROM MaintenanceRecords),
       Account.Name,
       Product2.ProductCode
FROM Asset
WHERE Id = :recordId
```

Just ensure your template uses the correct field paths.

---

### Q: Can I use the same template for multiple object types?

**A:** No. Each template has a single **Primary Parent** object. Create separate templates for each object type.

---

### Q: How do I add an object that's in a managed package?

**A:** Same process! Use the full API name including namespace:
- Object API Name: `namespace__CustomObject__c`
- Lookup Field: `namespace__CustomObject__c`
- Works with any managed package object

---

### Q: Can I test without affecting production users?

**A:** Yes! Best practice:
1. Create Custom Metadata record with **Is Active = false**
2. Test in Sandbox or scratch org first
3. Activate and promote to production when ready

---

### Q: What's the difference between "Object API Name" and "Lookup Field API Name"?

**A:**
- **Object API Name:** The Salesforce object (e.g., "Asset", "Contact", "Custom__c")
- **Lookup Field API Name:** The field on Generated_Document__c (e.g., "Asset__c", "Contact__c", "Custom__r")

They're similar but not identical. The lookup field has `__c` or `__r` suffix.

---

## Next Steps

### After Configuring Your First Object

1. ✅ Create templates with sample data
2. ✅ Test with edge cases (null values, missing relationships)
3. ✅ Train users on the new capability
4. ✅ Monitor Generated Documents tab for errors
5. ✅ Review [admin-runbook.md](./admin-runbook.md) for operational procedures

### Additional Resources

- **[Template Authoring Guide](./template-authoring.md)** - How to create DOCX templates
- **[Field Path Conventions](./field-path-conventions.md)** - Data structure reference
- **[admin-runbook.md](./admin-runbook.md)** - Operational procedures and troubleshooting

### Sample Files

- `samples/templates/Contact-Template-Spec.md` - Contact template specification
- `samples/templates/Lead-Template-Spec.md` - Lead template specification
- `samples/templates/Asset-Template-Spec.md` - Asset template specification
- `samples/contact.json` - Sample data envelope for Contact
- `samples/lead.json` - Sample data envelope for Lead

---

## Support

For additional help:
- Check [Troubleshooting](#troubleshooting) section above
- Review error messages carefully (they include remediation guidance)
- Consult [admin-runbook.md](./admin-runbook.md) for operational procedures
- Contact your Salesforce administrator or system integrator

---

**Last Updated:** 2025-11-17 (T-11 Implementation)
**Document Version:** 1.0
**Audience:** Salesforce Administrators
