# Composite Document Template Management Guide

## Overview

This guide explains how to add and manage Docgen Templates within Composite Documents using the junction object `Composite_Document_Template__c`.

---

## Quick Start: Adding Templates to Composite Documents

There are **three ways** to add templates to a composite document:

### Method 1: Quick Action (Recommended) ⚡

1. Navigate to a Composite Document record
2. Click the **"Add Template"** quick action button in the highlights panel
3. Fill in the fields:
   - **Docgen Template**: Select from available templates
   - **Namespace**: Enter a unique identifier (e.g., "Account", "Terms", "Contact")
   - **Sequence**: Enter order number (e.g., 10, 20, 30)
   - **Active**: Check to enable (defaults to checked)
   - **Inclusion Formula**: Optionally enter a Salesforce Boolean formula to conditionally include the template
4. Click **Save**

### Method 2: Related List

1. Navigate to a Composite Document record
2. Scroll to the **"Composite Document Templates"** related list
3. Click **New**
4. Fill in the fields:
   - **Composite Document**: Auto-populated
   - **Document Template**: Select template
   - **Namespace**: Enter unique identifier
   - **Sequence**: Enter order number
   - **Active**: Check to enable
   - **Inclusion Formula**: Optionally enter a Salesforce Boolean formula
5. Click **Save**

### Method 3: LWC Component (Advanced) 🚀

1. Navigate to a Composite Document record page in Lightning App Builder
2. Add the **"Add Template to Composite"** component to the page
3. The component provides:
   - **Dropdown** of all active templates
   - **Auto-suggestion** of namespace from template name
   - **Validation** to prevent duplicates
   - **Auto-increment** of sequence numbers
   - **Conditional inclusion formula** entry
4. Users can quickly add multiple templates without leaving the page

---

## Understanding Junction Record Fields

### Required Fields

#### Composite Document (`Composite_Document__c`)
- **Type**: Master-Detail relationship
- **Purpose**: Links to the parent composite document
- **Auto-populated**: Yes (when using quick action or related list)

#### Document Template (`Document_Template__c`)
- **Type**: Lookup relationship
- **Purpose**: References the Docgen_Template__c to include
- **Example**: "Account Summary Template", "Terms and Conditions"

#### Namespace (`Namespace__c`)
- **Type**: Text (80 characters)
- **Purpose**: Unique key for this template's data in the merged document
- **Rules**:
  - Must start with a letter
  - Can contain letters, numbers, and underscores only
  - Must be unique within the composite document
- **Examples**: `Account`, `Terms`, `PrimaryContact`, `RelatedOpportunities`

#### Sequence (`Sequence__c`)
- **Type**: Number (no decimals)
- **Purpose**: Defines processing order (lower numbers processed first)
- **Best Practice**: Use increments of 10 (e.g., 10, 20, 30) to allow insertion of templates in between
- **Examples**: `10` (first), `20` (second), `30` (third)

### Optional Fields

#### Active (`IsActive__c`)
- **Type**: Checkbox
- **Purpose**: Control whether template is included in generation
- **Default**: Checked (true)
- **Use Case**: Temporarily disable a template without deleting the junction record

#### Inclusion Formula (`Inclusion_Formula__c`)
- **Type**: Long Text Area (3,900 characters)
- **Purpose**: Include this child template only when a Salesforce Boolean formula evaluates to true
- **Context**: The source record selected for the related Docgen Template
- **Default**: Blank, which always includes the template
- **Strategy**: Supported only for **Concatenate Templates** composites

### Inclusion Formula Syntax

The expression uses Salesforce formula syntax and must return `TRUE` or `FALSE`. Do not start it with `=`. Use field API names from the source object selected for the related Docgen Template.

Common examples:

```text
CONTAINS(Additional_Templates__c, "ABC")
IF(CONTAINS(Additional_Templates__c, "ABC"), TRUE, FALSE)
AnnualRevenue > 100000
AND(ISPICKVAL(Status__c, "Draft"), Amount__c >= 5000)
NOT(ISBLANK(Effective_Date__c))
Account.Industry = "Technology"
```

`IF` is supported when both outcomes are Boolean:

```text
IF(Amount__c >= 10000, TRUE, FALSE)
IF(
    ISPICKVAL(Status__c, "Draft"),
    NOT(ISBLANK(Effective_Date__c)),
    FALSE
)
```

The first example can be shortened to `Amount__c >= 10000`. Use `IF` when the true and false branches contain different Boolean logic.

### Supported Formula Features

| Category | Supported syntax and examples |
| --- | --- |
| Logical | `IF`, `AND`, `OR`, `NOT`, `TRUE`, `FALSE`, `&&`, `||` |
| Comparison | `=`, `==`, `!=`, `<>`, `<`, `>`, `<=`, `>=` |
| Text | `CONTAINS`, `BEGINS`, `LEN`, `LOWER`, `UPPER`, `TRIM`, `LEFT`, `RIGHT` |
| Blank values | `ISBLANK`, `BLANKVALUE` |
| Number, currency, percent | Numeric comparisons and `+`, `-`, `*`, `/`, including functions such as `ROUND`, `MIN`, and `MAX` |
| Checkbox | Direct Boolean fields, for example `Is_Approved__c = TRUE` |
| Picklist | `ISPICKVAL(Status__c, "Draft")` or `TEXT(Status__c) = "Draft"` |
| Multi-select picklist | `INCLUDES(Additional_Templates__c, "ABC")` |
| Date and date/time | `TODAY`, `NOW`, `DATE`, `DATEVALUE`, and date comparisons |
| Parent relationships | Parent fields such as `Account.Industry = "Technology"` |

The source field does not have to be selected in the Docgen Template SOQL. DocGen reads the formula's referenced fields and queries them from the source record before evaluation.

### Formula Rules And Limitations

- Use double quotes for text values: `"ABC"`. Single quotes are invalid Salesforce formula syntax.
- Field names are case-sensitive and must exist on the child template's source object.
- Blank number and currency fields remain blank rather than becoming zero. Use `ISBLANK` or `BLANKVALUE` when needed.
- A blank Inclusion Formula always includes the child template.
- A `FALSE` or null result skips the child template and its data provider.
- An invalid formula, missing field, missing source record, or non-Boolean result fails generation with the junction and template identified in the error.
- If every active child is skipped, generation fails instead of producing an empty document.
- Child collections, aggregate expressions over related lists, and array iteration are not supported.
- Data from another template namespace and arbitrary custom-provider JSON cannot be referenced.
- JavaScript and Docx template commands are not supported in this field.
- Record-change functions such as `ISNEW`, `ISCHANGED`, and `PRIORVALUE` are not supported because generation evaluates an existing record outside a save transaction.
- Inclusion Formula is supported only by the **Concatenate Templates** strategy.

---

## Validation Rules

The system enforces these validation rules:

### 1. Unique Namespace
**Rule**: Each namespace must be unique within a composite document

**Error**: "A template with namespace 'Account' already exists in this composite document. Please use a different namespace."

**Solution**: Use a descriptive, unique namespace like `AccountPrimary`, `AccountDetails`, `AccountSummary`

### 2. Valid Namespace Format
**Rule**: Namespace must start with a letter and contain only alphanumeric characters and underscores

**Valid**: `Account`, `Terms_v2`, `Contact1`
**Invalid**: `123Account` (starts with number), `Account Terms` (contains space), `Account-Terms` (contains hyphen)

### 3. Required Fields
**Rule**: Composite Document, Document Template, Namespace, and Sequence are all required

**Error**: "These required fields must be completed: [field name]"

### 4. Inclusion Formula Strategy
**Rule**: Inclusion Formula is allowed only when the parent Composite Document uses **Concatenate Templates**

**Error**: "Inclusion Formula is supported only when the Composite Document strategy is 'Concatenate Templates'."

**Reason**: Own Template has one physical master file, so an individual child file cannot be skipped.

---

## Best Practices

### Namespace Naming

✅ **Good Naming**:
- `Account` - Simple, clear
- `PrimaryContact` - Descriptive, camelCase
- `Terms_2024` - Version indicator
- `RelatedOpps` - Abbreviated but understandable

❌ **Poor Naming**:
- `1Account` - Starts with number (invalid)
- `Account Data` - Contains space (invalid)
- `a` - Too vague
- `AccountAccountAccountData` - Too verbose

### Sequence Numbering

**Use increments of 10**:
```
Template A: 10
Template B: 20
Template C: 30
```

**Why?** Allows easy insertion:
```
Template A: 10
Template B: 20
Template NEW: 25  ← Insert between
Template C: 30
```

**Avoid consecutive numbers**:
```
Template A: 1
Template B: 2
Template C: 3  ← Hard to insert between 2 and 3
```

### Template Organization

Group related templates by sequence ranges:
- **10-19**: Header/Cover templates
- **20-29**: Primary content templates
- **30-39**: Detail/line item templates
- **40-49**: Terms and conditions
- **50-59**: Footer/signature templates

---

## Common Workflows

### Workflow 1: Building a Multi-Section Document

**Scenario**: Create a composite document with Account summary, Contact details, and Terms

**Steps**:
1. Create or navigate to a Composite Document record
2. Add templates using Quick Action:
   - **Template**: "Account Summary" → **Namespace**: `Account` → **Sequence**: `10`
   - **Template**: "Contact Details" → **Namespace**: `Contact` → **Sequence**: `20`
   - **Template**: "Terms and Conditions" → **Namespace**: `Terms` → **Sequence**: `30`
3. Save each junction record
4. Test generation using the `compositeDocgenButton` LWC component

### Workflow 2: Reordering Templates

**Scenario**: Move "Terms and Conditions" to appear before "Contact Details"

**Steps**:
1. Navigate to Composite Document record
2. In the "Composite Document Templates" related list, click **Edit** on the Contact Details junction record
3. Change **Sequence** from `20` to `30`
4. Click **Save**
5. Click **Edit** on the Terms junction record
6. Change **Sequence** from `30` to `20`
7. Click **Save**

**Result**: Processing order is now: Account (10) → Terms (20) → Contact (30)

### Workflow 3: Temporarily Disabling a Template

**Scenario**: Exclude "Contact Details" from generation without deleting the configuration

**Steps**:
1. Navigate to Composite Document record
2. In the "Composite Document Templates" related list, click **Edit** on the Contact Details junction record
3. Uncheck **Active**
4. Click **Save**

**Result**: Contact Details will be skipped during generation. To re-enable, check **Active** again.

### Workflow 4: Replacing a Template

**Scenario**: Replace "Old Terms" template with "New Terms v2"

**Steps**:
1. Navigate to Composite Document record
2. **Option A (Preferred)**: Edit existing junction record
   - Click **Edit** on the "Old Terms" junction record
   - Change **Document Template** to "New Terms v2"
   - Click **Save**
   - Namespace and sequence remain unchanged

3. **Option B**: Delete and recreate
   - Click **Delete** on the "Old Terms" junction record
   - Click **Add Template** quick action
   - Select "New Terms v2" template
   - Use same namespace (`Terms`) and sequence (`30`)
   - Click **Save**

**Best Practice**: Use Option A to preserve junction record ID references.

### Workflow 5: Conditionally Including Clauses

**Scenario**: Include the Clauses template only when `Additional_Templates__c` contains `ABC`

**Steps**:
1. Confirm the Composite Document uses **Concatenate Templates**
2. Open the Clauses junction record from the Composite Document Templates related list
3. Edit **Inclusion Formula** and enter:

```text
CONTAINS(Additional_Templates__c, "ABC")
```

4. Save the junction record
5. Generate once with `ABC` present and once without it

**Result**: The Clauses DOCX is merged only when the formula returns true. When false, its data provider and merge are skipped.

---

## Troubleshooting

### Issue: "A template with namespace 'X' already exists"

**Cause**: Duplicate namespace within the same composite document

**Solutions**:
1. Choose a different namespace (e.g., `AccountSummary` instead of `Account`)
2. Delete or edit the existing junction record with that namespace
3. Check for inactive junction records that may still use the namespace

### Issue: "Namespace must start with a letter"

**Cause**: Namespace starts with a number or special character

**Solutions**:
- `123Account` → Change to `Account123` or `Account`
- `_Terms` → Change to `Terms`

### Issue: "Templates processing in wrong order"

**Cause**: Sequence numbers not in desired order

**Solution**:
1. Review all junction records in the related list
2. Sort by **Sequence** column (click column header)
3. Edit sequence numbers to match desired order
4. Use gaps (10, 20, 30) to allow future reordering

### Issue: "Template not appearing in generated document"

**Possible Causes**:
1. Junction record **Active** checkbox is unchecked
2. Template itself is inactive (`Docgen_Template__c.IsActive__c = false`)
3. Namespace doesn't match data provided during generation
4. Inclusion Formula evaluated to false
5. Template processing failed (check `Generated_Document__c.Error__c` field)

**Solutions**:
1. Check **Active** checkbox on junction record
2. Verify template is active: Navigate to Docgen Template record → Check **Active** field
3. Review namespace spelling and case sensitivity
4. Review the Inclusion Formula against the source record values
5. Check error messages in Generated Document record

### Issue: Inclusion Formula fails generation

**Possible Causes**:
1. Text values use single quotes instead of double quotes
2. A field API name is misspelled or does not exist on the child template's source object
3. The expression returns text or a number instead of Boolean
4. No source record ID was supplied for the child template
5. Every active child formula evaluated to false

**Solutions**:
1. Use syntax such as `CONTAINS(Name, "ABC")`
2. Use `ISPICKVAL(Status__c, "Draft")` for picklists
3. Use `ISBLANK` or `BLANKVALUE` when null handling matters
4. Confirm generation passes the record ID key required by the Docgen Template
5. Keep at least one unconditional template, such as a header, if the composite must always produce a file

---

## API & Apex Usage

For developers building custom integrations:

### Query Junction Records

```apex
List<Composite_Document_Template__c> junctions = [
    SELECT Id, Namespace__c, Sequence__c, IsActive__c, Inclusion_Formula__c,
           Document_Template__c, Document_Template__r.Name,
           Composite_Document__c
    FROM Composite_Document_Template__c
    WHERE Composite_Document__c = :compositeDocId
      AND IsActive__c = true
    ORDER BY Sequence__c ASC
];
```

### Create Junction Record

```apex
Composite_Document_Template__c junction = new Composite_Document_Template__c(
    Composite_Document__c = compositeDocId,
    Document_Template__c = templateId,
    Namespace__c = 'Account',
    Sequence__c = 10,
    IsActive__c = true,
    Inclusion_Formula__c = 'CONTAINS(Name, "ABC")'
);
insert junction;
```

### Using CompositeDocumentController

```javascript
// LWC: Get active templates
import getActiveTemplates from '@salesforce/apex/CompositeDocumentController.getActiveTemplates';

// LWC: Add template
import addTemplateToComposite from '@salesforce/apex/CompositeDocumentController.addTemplateToComposite';

const junctionId = await addTemplateToComposite({
    compositeDocId: this.recordId,
    templateId: selectedTemplateId,
    namespace: 'Account',
    sequence: 10,
    isActive: true,
    inclusionFormula: 'CONTAINS(Name, "ABC")'
});
```

---

## Security & Permissions

### Required Permissions

Users need the following permissions to manage junction records:

**Docgen User Permission Set**:
- ✅ Read access to `Composite_Document__c`
- ✅ Read access to `Docgen_Template__c`
- ✅ Read access to `Composite_Document_Template__c` (junction)
- ✅ Execute access to `CompositeDocumentController` Apex class

**Admin/Power Users** (for creating/editing junctions):
- ✅ Create/Edit/Delete access to `Composite_Document_Template__c`

### Object-Level Security

The `Composite_Document_Template__c` junction object follows the master-detail relationship cascade:
- **Delete**: Deleting a Composite Document deletes all junction records
- **Sharing**: Junction records inherit sharing from parent Composite Document
- **Ownership**: Junction record owner is the same as Composite Document owner

---

## Related Documentation

- [LWC Composite Button Guide](lwc-composite-button-guide.md) - Interactive generation button configuration
- [Docgen Template Guide](docgen-template-guide.md) - Creating and configuring templates

---

**Version**: 1.1
**Last Updated**: 2026-07-01
**Component**: Composite Document Template Management
