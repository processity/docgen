# Admin Configuration Guide: Object Configurability

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start: Adding a New Object](#quick-start-adding-a-new-object)
4. [Step-by-Step: Adding Asset Object Support](#step-by-step-adding-asset-object-support)
5. [Creating Templates for New Objects](#creating-templates-for-new-objects)
6. [Deactivating an Object](#deactivating-an-object)
7. [Composite Documents](#composite-documents)
8. [Troubleshooting](#troubleshooting)
9. [Frequently Asked Questions](#frequently-asked-questions)

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

## Composite Documents

### What are Composite Documents?

**Composite Documents** allow you to combine data from **multiple sources** (SOQL queries or custom Apex providers) into a **single PDF output**. This enables complex documents that pull data from multiple objects or different queries on the same object.

**Example Use Cases:**
- Account Summary + Terms & Conditions
- Case Details + Account Info + Contact Info
- Opportunity with Line Items + Custom Pricing Terms
- Invoice with multiple data sources (billing, shipping, line items, terms)

### Key Concepts

#### Namespaces
Each data source is isolated in its own **namespace** to prevent field name collisions.

**Example:**
- Namespace `Account`: Contains Account data
- Namespace `Terms`: Contains Terms & Conditions data
- Namespace `LineItems`: Contains product line items

#### Template Strategies

There are **two ways** to combine data sources:

1. **Own Template**: Create a single template that references all namespaces (e.g., `{{Account.Name}}`, `{{Terms.Text}}`)
2. **Concatenate Templates**: Use multiple templates (one per namespace) that are automatically merged and concatenated with section breaks

#### Objects Involved

- **Composite_Document__c**: Main configuration record
- **Composite_Document_Template__c**: Junction records (many-to-many) linking Composite Documents to Templates
- **Docgen_Template__c**: Your existing document templates
- **Generated_Document__c**: Links to Composite_Document__c instead of (or in addition to) Template__c

---

### When to Use Composite Documents

| Scenario | Single Template | Composite Document |
|----------|----------------|-------------------|
| Simple single-object reports | ✅ Recommended | ❌ Overkill |
| Multi-object summaries (Account + Opportunities) | ❌ Limited | ✅ Perfect |
| Reusing existing template libraries | ❌ Requires merging | ✅ Concatenate strategy |
| Adding standard terms to custom reports | ❌ Copy-paste | ✅ Namespace isolation |
| Complex calculations across objects | ❌ Single SOQL limit | ✅ Multiple providers |

**Rule of Thumb:**
- **1 data source** → Use Single Template
- **2+ data sources** → Use Composite Document

---

### Quick Start: Creating a Composite Document

**Time Required:** ~20-25 minutes

**Example:** Account Summary with Terms & Conditions

#### Step 1: Create Individual Templates (if needed)

If you're using **Concatenate Templates** strategy and already have templates, skip to Step 2.

**Template 1: Account Summary**
- Primary Parent: Account
- SOQL: `SELECT Id, Name, Industry, AnnualRevenue, (SELECT Name, Email FROM Contacts) FROM Account WHERE Id = :recordId`
- Upload DOCX template with fields like `{{Name}}`, `{{Industry}}`, etc.

**Template 2: Terms & Conditions**
- Primary Parent: (can be any object, or custom Terms object)
- SOQL: `SELECT Id, StandardTerms__c, EffectiveDate__c FROM Terms__c LIMIT 1`
- Upload DOCX template with `{{StandardTerms__c}}`, `{{EffectiveDate__c__formatted}}`

#### Step 2: Create Composite_Document__c Record

1. Navigate to **Composite Documents** tab (App Launcher → Composite Documents)
2. Click **New**
3. Fill in fields:

**Name:** `Account Summary with Terms` (auto-numbered like CD-00001)

**Description:** `Complete account overview including contacts and standard terms`

**Template Strategy:** Choose one:
- **Own Template**: If you want to create a single master template
- **Concatenate Templates**: If you want to reuse existing templates

**Template Content Version ID:** (Only if using "Own Template" strategy)
- Upload your composite template DOCX file
- Copy the ContentVersionId
- Paste here

**Primary Parent:** `Account`
- The main object this composite relates to

**Store Merged DOCX:** ☐ Unchecked (optional)
**Return DOCX to Browser:** ☐ Unchecked (usually PDF)
**Is Active:** ☑ Checked

4. Click **Save**

#### Step 3: Create Junction Records (Composite_Document_Template__c)

For each data source / template, create a junction record:

**Junction Record 1:**
1. Click **New Composite Document Template** (related list on Composite Document)
2. Fill in:
   - **Composite Document:** (auto-filled)
   - **Document Template:** Select "Account Summary" template
   - **Namespace:** `Account`
   - **Sequence:** `10`
   - **Is Active:** ☑ Checked
3. Click **Save**

**Junction Record 2:**
1. Click **New** again
2. Fill in:
   - **Composite Document:** (auto-filled)
   - **Document Template:** Select "Terms & Conditions" template
   - **Namespace:** `Terms`
   - **Sequence:** `20`
   - **Is Active:** ☑ Checked
3. Click **Save**

**Important:**
- **Namespace** must be unique per composite document
- **Sequence** determines execution order (10, 20, 30...)
- Lower sequences execute first

#### Step 4: Test Generation

**Option A: Interactive (LWC Button)**

1. Add `compositeDocgenButton` component to Account page layout
2. Configure component properties:
   - Composite Document ID: (your CD record ID)
   - Record ID Field: `accountId`
   - Button Label: "Generate Summary with Terms"
3. Navigate to an Account record
4. Click the button
5. PDF should open with both Account data and Terms

**Option B: Apex (Developer Console)**

```apex
// Get test Account
Account testAccount = [SELECT Id FROM Account LIMIT 1];

// Get Composite Document
Composite_Document__c composite = [
    SELECT Id
    FROM Composite_Document__c
    WHERE Name = 'Account Summary with Terms'
    LIMIT 1
];

// Build recordIds map (JSON string)
Map<String, Id> recordIds = new Map<String, Id>{
    'accountId' => testAccount.Id
};
String recordIdsJson = JSON.serialize(recordIds);

// Generate composite document
String downloadUrl = DocgenController.generateComposite(
    composite.Id,
    recordIdsJson,
    'PDF'
);

System.debug('Download URL: ' + downloadUrl);
```

#### Step 5: Verify Output

1. Open the generated PDF
2. Verify it contains:
   - Account data in first section
   - Terms & Conditions in second section
   - Section break between them (if using Concatenate strategy)
3. Check **Generated Documents** tab:
   - **Composite Document** field should link to your composite
   - **Status** should be "SUCCEEDED"

---

### Strategy 1: Own Template (Single Master Template)

#### When to Use
- Building a new document from scratch
- Need full control over layout
- Want to reference data across namespaces
- Simple multi-source documents

#### Configuration

**Composite_Document__c Settings:**
- Template Strategy: **Own Template**
- Template Content Version ID: **Required** (your master template)

**Template Syntax:**

Access namespace data using `{{Namespace.FieldPath}}`:

```
ACCOUNT OVERVIEW

Company: {{Account.Name}}
Revenue: {{Account.AnnualRevenue__formatted}}

CONTACTS
{{FOR contact IN Account.Contacts}}
  - {{$contact.Name}} ({{$contact.Email}})
{{END-FOR contact}}

TERMS & CONDITIONS

{{Terms.StandardTerms}}

Effective: {{Terms.EffectiveDate__formatted}}
```

**Data Structure:**

Your template receives a single data object with all namespaces:

```json
{
  "Account": {
    "Name": "Acme Ltd",
    "AnnualRevenue__formatted": "£5M",
    "Contacts": [...]
  },
  "Terms": {
    "StandardTerms": "...",
    "EffectiveDate__formatted": "01 Jan 2025"
  }
}
```

---

### Strategy 2: Concatenate Templates (Multi-Template Merge)

#### When to Use
- Reusing existing single-object templates
- Need different headers/footers per section
- Building modular template libraries
- Each section has distinct formatting

#### Configuration

**Composite_Document__c Settings:**
- Template Strategy: **Concatenate Templates**
- Template Content Version ID: **Leave blank**

**Template Syntax:**

Each template references **its own namespace's data directly** (no namespace prefix):

**Template 1 (Namespace: "Account"):**
```
ACCOUNT SUMMARY

Name: {{Name}}
Industry: {{Industry}}
Revenue: {{AnnualRevenue__formatted}}
```

**Template 2 (Namespace: "Terms"):**
```
TERMS & CONDITIONS

{{StandardTerms}}
Effective: {{EffectiveDate__formatted}}
```

**Final Output:**

The system:
1. Merges Template 1 with Account data
2. Merges Template 2 with Terms data
3. Concatenates both DOCX files with section breaks
4. Converts to PDF

---

### Advanced: Using Custom Data Providers

For complex data requirements, you can use **Custom Apex Providers** instead of SOQL.

#### Example: Custom Pricing Calculator

**Apex Provider:**
```apex
public class CustomPricingProvider implements DocgenDataProvider {
    public Map<String, Object> buildData(
        Id recordId,
        Docgen_Template__c template,
        String locale,
        String timezone
    ) {
        // Complex business logic
        Opportunity opp = [SELECT Id, Amount, Discount__c FROM Opportunity WHERE Id = :recordId];

        Decimal finalPrice = calculateComplexPricing(opp);

        return new Map<String, Object>{
            'CalculatedPrice__formatted' => formatCurrency(finalPrice, locale),
            'DiscountApplied' => opp.Discount__c,
            'PricingNotes' => getPricingNotes(opp)
        };
    }
}
```

**Template Configuration:**
- Data Source: `Custom`
- Class Name: `CustomPricingProvider`

**Junction Record:**
- Namespace: `Pricing`
- Document Template: (template using CustomPricingProvider)
- Sequence: 30

**Template Usage:**
```
PRICING DETAILS

Final Price: {{Pricing.CalculatedPrice__formatted}}
Discount Applied: {{Pricing.DiscountApplied}}%

Notes: {{Pricing.PricingNotes}}
```

---

### Namespace Best Practices

#### 1. Use Descriptive Names

**Good:**
- `Account`, `PrimaryContact`, `Terms`, `LineItems`, `Pricing`

**Avoid:**
- `Data1`, `NS1`, `Obj`, `Template1`

#### 2. Keep Sequences with Gaps

Use multiples of 10 to allow inserting new templates later:

```
Sequence 10: Account
Sequence 20: Contacts
Sequence 25: Opportunities (added later)
Sequence 30: Terms
```

#### 3. Document Your Namespaces

Add description to Composite_Document__c record:

```
Namespaces:
- Account (seq 10): Company overview and financials
- Contacts (seq 20): Key contacts with email/phone
- Terms (seq 30): Standard T&C effective 2025
```

#### 4. Prevent Namespace Collisions

The system enforces **unique namespaces per composite**. If you try to create two junction records with the same namespace, you'll get an error.

**Example:**
- ❌ Account (seq 10) + Account (seq 20) = **ERROR**
- ✅ Account (seq 10) + RelatedAccount (seq 20) = **OK**

---

### Batch Generation with Composites

You can generate composite documents in batch mode using `BatchDocgenEnqueue`:

```apex
// Example: Generate Account Summaries with Terms for all Enterprise accounts
Composite_Document__c composite = [
    SELECT Id
    FROM Composite_Document__c
    WHERE Name = 'Account Summary with Terms'
    LIMIT 1
];

// Query accounts that need documents
String query = 'SELECT Id, Name FROM Account WHERE Type = \'Enterprise\' AND AnnualRevenue > 10000000';

// Additional recordIds (if needed for some templates)
Map<String, Id> additionalIds = new Map<String, Id>();
// Leave empty if only using primary recordId

// Enqueue batch
BatchDocgenEnqueue batch = new BatchDocgenEnqueue(
    composite.Id,          // Composite Document ID
    query,                 // SOQL for batch scope
    additionalIds,         // Additional static record IDs
    'PDF',                 // Output format
    5                      // Priority (optional)
);

Database.executeBatch(batch, 50);
```

**Batch Execution:**
1. Poller picks up QUEUED records
2. For each composite, executes all data providers in sequence
3. Merges templates according to strategy
4. Uploads PDF to Salesforce Files
5. Links to all parent records
6. Updates status to SUCCEEDED

---

### Troubleshooting Composite Documents

#### Issue: "Duplicate namespace: Account"

**Cause:** Two junction records have the same Namespace__c value

**Solution:**
1. Navigate to Composite Document record
2. View Composite Document Templates related list
3. Find duplicate namespaces
4. Rename one to be unique (e.g., "RelatedAccount")
5. Update your template to use the new namespace

---

#### Issue: Template shows blank data

**Cause:** Namespace mismatch or missing data

**Solutions:**

**For Own Template strategy:**
- Verify template uses `{{Namespace.Field}}` syntax (not `{{Field}}`)
- Check junction record has correct Namespace__c value
- Verify data provider returns data (check debug logs)

**For Concatenate Templates strategy:**
- Verify template uses `{{Field}}` syntax (not `{{Namespace.Field}}`)
- Each template should reference its own namespace's data directly
- Check that template is assigned to correct namespace in junction record

---

#### Issue: Sections in wrong order

**Cause:** Sequence__c values not set correctly

**Solution:**
1. Review junction records
2. Verify Sequence__c values (10, 20, 30...)
3. Lower sequences execute first
4. Update sequences if needed
5. Verify all junction records have IsActive__c = true

---

#### Issue: Missing namespace data

**Cause:** One of the data providers failed or returned no data

**Solution:**
1. Check Generated_Document__c.Error__c field for details
2. Test each template individually first
3. Verify SOQL queries return data
4. Check that recordIds map contains all required IDs
5. Review Apex debug logs with correlation ID

---

#### Issue: "Missing namespace data: Terms"

**Cause:** Template expects namespace "Terms" but junction records don't define it

**Solution:**
1. Navigate to Composite Document record
2. Verify junction record exists with Namespace__c = "Terms"
3. Verify junction record IsActive__c = true
4. Check Sequence__c is set
5. Verify Document Template is selected

---

### Composite Documents FAQ

#### Q: Can I mix SOQL and Custom providers in one composite?

**A:** Yes! Each junction record can reference a template with either Data Source = "SOQL" or "Custom". The system executes all providers in sequence order.

---

#### Q: How many namespaces can I have?

**A:** No hard limit. However, for performance and maintainability, **2-5 namespaces** is recommended. More than 10 may impact performance.

---

#### Q: Can I reuse the same template in multiple composites?

**A:** Yes! Templates are reusable. You can reference the same template in multiple composite documents, potentially with different namespaces.

---

#### Q: What if two namespaces need the same record ID?

**A:** The recordIds map supports multiple keys pointing to the same ID:

```apex
Map<String, Id> recordIds = new Map<String, Id>{
    'accountId' => acc.Id,
    'primaryAccountId' => acc.Id  // Same ID, different key
};
```

---

#### Q: Can I use composite documents in Flow/Process Builder?

**A:** Not directly. Use Apex-invocable actions or invoke the batch class from Flow. For interactive generation, use the LWC button component on record pages.

---

#### Q: How does idempotency work with composites?

**A:** The RequestHash includes:
- Composite Document ID
- All namespace data
- recordIds map
- Output format

Same inputs within 24 hours = cached result (no duplicate generation)

---

#### Q: Can I preview composite data before generating?

**A:** Yes! Check the Generated_Document__c.RequestJSON__c field. It contains the full envelope with all namespace data that was sent to the backend.

---

#### Q: What happens if one namespace fails?

**A:** The entire composite generation fails. Status = FAILED with error details in Error__c field. Fix the failing namespace and retry.

---

### See Also

For detailed composite document information:
- **[Template Authoring Guide](template-authoring.md)** - Namespace syntax and composite template examples
- **[LWC Composite Button Guide](lwc-composite-button-guide.md)** - Interactive generation from Lightning pages
- **[Composite Batch Examples](composite-batch-examples.md)** - Batch generation patterns
- **[API Documentation](api.md)** - Composite request envelope format

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
