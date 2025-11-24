# Template Authoring Guide

This guide explains how to create DOCX templates for the Salesforce PDF Generation system using `docx-templates`.

## Table of Contents

1. [Overview](#overview)
2. [Field Path Conventions](#field-path-conventions)
3. [Basic Syntax](#basic-syntax)
4. [Working with Data](#working-with-data)
5. [Loops and Arrays](#loops-and-arrays)
6. [Conditional Logic](#conditional-logic)
7. [JavaScript Expressions](#javascript-expressions)
8. [Formatted Values](#formatted-values)
9. [Images](#images)
10. [Composite Documents](#composite-documents)
11. [Best Practices](#best-practices)
12. [Examples](#examples)
13. [Troubleshooting](#troubleshooting)

---

## Overview

Templates are standard Microsoft Word (.docx) files with special tags that get replaced with data from Salesforce. The system uses the `docx-templates` library with native syntax using `{{` and `}}` delimiters.

### Key Principles

- **Salesforce API Names**: Use exact Salesforce API field names (e.g., `Account.Name`, `Opportunity.Amount`)
- **No SOQL in Templates**: All data is prepared by Apex and sent to the template as a complete JSON object
- **Deterministic**: Templates should produce the same output for the same input data
- **Security**: External images must be on the allowlist; prefer base64-encoded images

---

## Field Path Conventions

### Standard Fields

Use Salesforce API names exactly as they appear:

```
{{Account.Name}}
{{Opportunity.StageName}}
{{Case.Subject}}
```

### Custom Fields

Include the `__c` suffix:

```
{{Account.Custom_Field__c}}
{{Opportunity.Special_Notes__c}}
```

### Related Objects

Use dot notation for relationships:

```
{{Opportunity.Owner.Name}}
{{Opportunity.Account.Name}}
{{Case.Contact.Email}}
```

### Formatted Values

Apex pre-formats currency, dates, numbers, and percentages. Use the `__formatted` suffix:

```
{{Opportunity.Amount__formatted}}
{{Opportunity.CloseDate__formatted}}
{{Account.AnnualRevenue__formatted}}
{{Opportunity.Probability__formatted}}
```

**Example data from Apex:**
```json
{
  "Opportunity": {
    "Amount": 250000,
    "Amount__formatted": "£250,000.00",
    "CloseDate": "2025-12-31",
    "CloseDate__formatted": "31 December 2025"
  }
}
```

---

## Basic Syntax

### Simple Field Replacement

```
Customer: {{Account.Name}}
Revenue: {{Account.AnnualRevenue__formatted}}
```

### Whitespace Handling

Tags can include spaces for readability:

```
{{ Account.Name }}
{{ Opportunity.StageName }}
```

---

## Working with Data

### Null/Missing Values

If a field is `null` or missing, it renders as empty:

```
Description: {{Account.Description}}
```

If `Description` is null, this renders as:
```
Description:
```

### Default Values with Conditionals

Use conditionals to provide defaults:

```
{{#if Account.Description}}
  {{Account.Description}}
{{else}}
  No description available
{{/if}}
```

---

## Loops and Arrays

### Basic Loop

Use `FOR`/`END-FOR` to iterate over arrays:

```
{{FOR item IN Opportunity.LineItems}}
  - {{$item.Name}}: {{$item.Quantity}} x {{$item.UnitPrice__formatted}} = {{$item.TotalPrice__formatted}}
{{END-FOR item}}
```

**Important:** Use `$item` prefix to access properties inside the loop.

### Table Rows

Create a table in Word with a single data row containing loop tags:

| Product | Quantity | Unit Price | Total |
|---------|----------|------------|-------|
| `{{FOR item IN Opportunity.LineItems}}{{$item.Name}}{{END-FOR item}}` | `{{$item.Quantity}}` | `{{$item.UnitPrice__formatted}}` | `{{$item.TotalPrice__formatted}}` |

**Note**: Place `{{FOR}}` and `{{END-FOR}}` in the same table cell for proper row repetition.

### Accessing Parent Context

Inside loops, use `..` to access parent data:

```
{{FOR item IN Opportunity.LineItems}}
  Opportunity: {{../Opportunity.Name}}
  Product: {{$item.Name}}
{{END-FOR item}}
```

### Loop with Index

Use JavaScript expressions to calculate index:

```
{{FOR item IN Opportunity.LineItems}}
  {{= Opportunity.LineItems.indexOf($item) + 1 }}. {{$item.Name}}
{{END-FOR item}}
```

### Empty Arrays

Check if array has items before looping:

```
{{IF Opportunity.LineItems.length}}
  {{FOR item IN Opportunity.LineItems}}
    - {{$item.Name}}
  {{END-FOR item}}
{{END-IF}}
```

---

## Conditional Logic

### Basic If

```
{{IF Account.IsPartner}}
  Partner Discount: 15%
{{END-IF}}
```

### If-Else

```
{{IF Opportunity.IsWon}}
  Congratulations! Deal closed.
{{END-IF}}
```

### Checking for Values

```
{{IF Account.AnnualRevenue}}
  Revenue: {{Account.AnnualRevenue__formatted}}
{{END-IF}}
```

### Multiple Conditions (AND)

For complex conditions, use JavaScript expressions:

```
{{IF Account.IsPartner && Account.IsActive}}
  Active Partner
{{END-IF}}
```

Or use nested IF blocks:

```
{{IF Account.IsPartner}}
  {{IF Account.IsActive}}
    Active Partner
  {{END-IF}}
{{END-IF}}
```

### Multiple Conditions (OR)

Use JavaScript expressions:

```
{{IF Account.IsPartner || Account.IsVIP}}
  Special discount available
{{END-IF}}
```

Or pre-compute in Apex for cleaner templates:

**Apex:**
```apex
data.put('ShouldShowDiscount', account.IsPartner || account.IsVIP);
```

**Template:**
```
{{IF ShouldShowDiscount}}
  Special discount available
{{END-IF}}
```

---

## JavaScript Expressions

Templates support JavaScript for dynamic calculations and data manipulation. However, **prefer Apex for complex logic** to keep templates deterministic.

### Basic JavaScript Syntax

Use `{{=` to evaluate JavaScript and insert the result:

```
Total Contacts: {{= Account.Contacts.length }}

Revenue per Employee: {{= (Account.AnnualRevenue / Account.NumberOfEmployees).toFixed(2) }}
```

### EXEC Blocks (No Output)

Use `{{EXEC` to execute JavaScript without inserting anything (useful for defining variables):

```
{{EXEC
  const contacts = Account.Contacts || [];
  const byDept = {};
  contacts.forEach(c => {
    const dept = c.Department || 'Unassigned';
    byDept[dept] = (byDept[dept] || 0) + 1;
  });
  deptList = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
}}

{{FOR dept IN deptList}}
  {{$dept[0]}}: {{$dept[1]}} contacts
{{END-FOR dept}}
```

**Key difference:**
- `{{= code }}` - Executes and **inserts result**
- `{{EXEC code }}` - Executes but **inserts nothing**

### Array Operations

**Filter:**
```
Open Opportunities: {{= Account.Opportunities.filter(o => o.StageName !== 'Closed Won' && o.StageName !== 'Closed Lost').length }}
```

**Map and Join:**
```
Contact Emails: {{= Account.Contacts.map(c => c.Email).join(', ') }}
```

**Reduce (Aggregate):**
```
Total Pipeline: {{= Account.Opportunities.reduce((sum, o) => sum + (o.Amount || 0), 0).toLocaleString('en-GB', {style: 'currency', currency: 'GBP'}) }}
```

### Conditional Expressions (Ternary)

```
Account Tier: {{= Account.AnnualRevenue > 10000000 ? 'Enterprise' : Account.AnnualRevenue > 1000000 ? 'Corporate' : 'SMB' }}

Status: {{= opportunityCount > 0 ? opportunityCount + ' opportunities' : 'No opportunities' }}
```

### Date Calculations

```
{{=
const closeDate = new Date($opp.CloseDate);
const today = new Date();
const diffDays = Math.ceil((closeDate - today) / (1000 * 60 * 60 * 24));
diffDays > 0 ? diffDays + ' days remaining' :
diffDays === 0 ? 'Closes TODAY' :
Math.abs(diffDays) + ' days overdue'
}}
```

### Number Formatting

```
Currency: {{= amount.toLocaleString('en-GB', {style: 'currency', currency: 'GBP'}) }}

Percentage: {{= (0.755).toLocaleString('en-GB', {style: 'percent'}) }}

Thousands separator: {{= number.toLocaleString('en-GB') }}
```

### Grouping and Aggregation

```
{{EXEC
const opps = Account.Opportunities || [];
const byStage = {};

opps.forEach(opp => {
  const stage = opp.StageName || 'Unknown';
  if (!byStage[stage]) {
    byStage[stage] = { count: 0, total: 0 };
  }
  byStage[stage].count++;
  byStage[stage].total += opp.Amount || 0;
});

stageList = Object.entries(byStage)
  .sort((a, b) => b[1].total - a[1].total)
  .map(([stage, data]) => ({
    stage: stage,
    count: data.count,
    total: data.total
  }));
}}

{{FOR stage IN stageList}}
{{$stage.stage}}: {{$stage.count}} opp{{= $stage.count > 1 ? 's' : '' }} | {{= $stage.total.toLocaleString('en-GB', {style: 'currency', currency: 'GBP'}) }}
{{END-FOR stage}}
```

### Safe Property Access

Always handle null/undefined values:

```
{{= (Account.Contacts || []).length }}

{{= Account.Owner?.Name || 'Unassigned' }}

{{= (opportunity.Amount || 0) }}
```

### Multi-line JavaScript

```
{{=
const contacts = Account.Contacts || [];
const total = contacts.length;
const withEmail = contacts.filter(c => c.Email).length;
const percentage = total > 0 ? ((withEmail / total) * 100).toFixed(1) : 0;
`${withEmail} of ${total} contacts have email (${percentage}%)`
}}
```

### Important Limitations

1. **Line breaks don't work:** `\n` in template literals won't create Word paragraph breaks
   - **Solution:** Use FOR loops to generate multiple paragraphs

2. **No cross-block variables:** Variables from one `{{=` block aren't available in another
   - **Solution:** Use EXEC blocks to define shared variables

3. **Avoid IIFEs:** Immediately Invoked Function Expressions are unnecessary
   - **Bad:** `{{= (() => { return value; })() }}`
   - **Good:** `{{= value }}`

4. **Keep it simple:** Complex logic should be in Apex
   - Templates are for presentation, not business logic

### When to Use JavaScript vs Apex

**Use JavaScript in templates for:**
- ✅ Simple calculations (length, counts)
- ✅ Array filtering and sorting
- ✅ Conditional text/formatting
- ✅ Grouping data for display

**Use Apex for:**
- ✅ Complex business logic
- ✅ Data fetching (SOQL)
- ✅ Currency/date formatting (locale-aware)
- ✅ Security/validation
- ✅ Calculations that need testing

---

## Formatted Values

All formatting is done by Apex to ensure consistency and locale correctness.

### Currency

```
Total: {{Opportunity.Amount__formatted}}
```

**Output:** `Total: £250,000.00` (locale-dependent)

### Dates

```
Close Date: {{Opportunity.CloseDate__formatted}}
```

**Output:** `Close Date: 31 December 2025` (en-GB) or `12/31/2025` (en-US)

### Date/Time

```
Created: {{Opportunity.CreatedDate__formatted}}
```

**Output:** `Created: 01 Jan 2025 10:30 GMT`

### Percentages

```
Probability: {{Opportunity.Probability__formatted}}
```

**Output:** `Probability: 75%`

### Numbers with Separators

```
Employees: {{Account.NumberOfEmployees__formatted}}
```

**Output:** `Employees: 1,234` (en-US) or `Employees: 1.234` (de-DE)

---

## Images

### Base64 Images (Recommended)

Apex embeds images as base64:

```apex
String logoBase64 = EncodingUtil.base64Encode(logoBlob);
data.put('CompanyLogo', 'data:image/png;base64,' + logoBase64);
```

**Template:**
```
{{{CompanyLogo}}}
```

**Note:** Use triple braces `{{{ }}}` for images to prevent HTML escaping.

### External Image URLs

External URLs must be on the allowlist configured via `IMAGE_ALLOWLIST` env var.

**Allowed domains example:**
```
IMAGE_ALLOWLIST=cdn.example.com,images.company.com
```

**Template:**
```
{{{Account.LogoUrl}}}
```

If `Account.LogoUrl` is `https://cdn.example.com/logo.png`, it will be loaded. URLs from other domains will fail.

### Image Sizing

Control image size in Word:
1. Insert a placeholder image in your template
2. Resize it to desired dimensions
3. Replace it with the template tag

The system will respect the placeholder's dimensions.

---

## Composite Documents

Composite Documents allow you to combine data from **multiple sources** (SOQL queries or custom Apex providers) into a single PDF output. Each data source is isolated in its own **namespace** to prevent field name collisions.

### What is a Composite Document?

A Composite Document configuration consists of:
- **Composite_Document__c**: The main configuration record
- **Composite_Document_Template__c**: Junction records that define which templates and data sources to use
- **Template Strategy**: How to combine the data sources

There are two template strategies:

1. **Own Template**: Use a single template that references all namespaces
2. **Concatenate Templates**: Use multiple templates (one per namespace) that are merged and concatenated into a single document

---

### Understanding Namespaces

A **namespace** is a named container for data from a specific source. It prevents field name collisions when combining data from multiple objects.

**Example:** If you want to combine Account data with Terms & Conditions:
- Namespace `Account`: Contains `{Name, Industry, AnnualRevenue__formatted, ...}`
- Namespace `Terms`: Contains `{TermsText, EffectiveDate__formatted, ...}`

Each namespace is defined in a `Composite_Document_Template__c` junction record with:
- **Namespace__c**: The key used in templates (e.g., "Account", "Terms", "Contacts")
- **Sequence__c**: Execution order for data providers and concatenation order
- **Document_Template__c**: The template configuration to use for this namespace

---

### Strategy 1: Own Template

With the **Own Template** strategy, you create a **single template** that references data from all namespaces using dot notation.

#### Configuration
- Set `Template_Strategy__c = "Own Template"`
- Set `TemplateContentVersionId__c` to your composite template
- Create junction records for each data source

#### Template Syntax

Access namespace data using `{{Namespace.FieldPath}}`:

```
ACCOUNT SUMMARY

Name: {{Account.Name}}
Industry: {{Account.Industry}}
Annual Revenue: {{Account.AnnualRevenue__formatted}}

CONTACTS

{{FOR contact IN Account.Contacts}}
  - {{$contact.Name}} ({{$contact.Email}})
{{END-FOR contact}}

TERMS AND CONDITIONS

{{Terms.TermsText}}

Effective Date: {{Terms.EffectiveDate__formatted}}
```

#### Data Structure

The data envelope sent to your template looks like this:

```json
{
  "Account": {
    "Name": "Acme Ltd",
    "Industry": "Technology",
    "AnnualRevenue__formatted": "£5,000,000",
    "Contacts": [
      {"Name": "John Smith", "Email": "john@acme.com"},
      {"Name": "Jane Doe", "Email": "jane@acme.com"}
    ]
  },
  "Terms": {
    "TermsText": "Standard terms apply...",
    "EffectiveDate__formatted": "01 Jan 2025"
  }
}
```

#### Example: Account Summary with Terms

**Template:**
```
CUSTOMER REPORT

Company: {{Account.Name}}
Revenue: {{Account.AnnualRevenue__formatted}}
Total Opportunities: {{= Account.Opportunities.length }}

OPPORTUNITY PIPELINE

{{FOR opp IN Account.Opportunities}}
  {{$opp.Name}} - {{$opp.StageName}} - {{$opp.Amount__formatted}}
{{END-FOR opp}}

{{IF Account.Opportunities.length > 0}}
Total Pipeline: {{= Account.Opportunities.reduce((sum, o) => sum + (o.Amount || 0), 0).toLocaleString('en-GB', {style: 'currency', currency: 'GBP'}) }}
{{END-IF}}

TERMS & CONDITIONS

{{Terms.StandardTerms}}

Effective: {{Terms.EffectiveDate__formatted}}
```

---

### Strategy 2: Concatenate Templates

With the **Concatenate Templates** strategy, you create **multiple templates** (one per namespace), and the system merges each template with its namespace data, then concatenates them into a single document with section breaks.

#### Configuration
- Set `Template_Strategy__c = "Concatenate Templates"`
- Leave `TemplateContentVersionId__c` blank
- Create junction records for each template, each with its own namespace and sequence

#### Template Syntax

Each template references **its own namespace's data directly** (no namespace prefix needed):

**Template 1 (Namespace: "Account", Sequence: 10):**
```
ACCOUNT SUMMARY

Name: {{Name}}
Industry: {{Industry}}
Annual Revenue: {{AnnualRevenue__formatted}}

CONTACTS:
{{FOR contact IN Contacts}}
  - {{$contact.Name}} ({{$contact.Email}})
{{END-FOR contact}}
```

**Template 2 (Namespace: "Terms", Sequence: 20):**
```
TERMS AND CONDITIONS

{{TermsText}}

Effective Date: {{EffectiveDate__formatted}}
```

#### Data Structure

Each template receives **only its namespace's data**:

**Template 1 receives:**
```json
{
  "Name": "Acme Ltd",
  "Industry": "Technology",
  "AnnualRevenue__formatted": "£5,000,000",
  "Contacts": [...]
}
```

**Template 2 receives:**
```json
{
  "TermsText": "Standard terms apply...",
  "EffectiveDate__formatted": "01 Jan 2025"
}
```

#### Section Breaks

The system automatically inserts **section breaks** between concatenated templates. Each section can maintain its own headers/footers from the original template.

---

### When to Use Each Strategy

| Use Case | Recommended Strategy |
|----------|---------------------|
| Reusing existing single-object templates | **Concatenate Templates** |
| Full control over layout and cross-namespace logic | **Own Template** |
| Need different headers/footers per section | **Concatenate Templates** |
| Simple multi-source document | **Own Template** |
| Combining standard templates (e.g., Terms & Conditions boilerplate) | **Concatenate Templates** |

---

### Composite Document Examples

#### Example 1: Account Summary with Opportunities and Terms (Own Template)

**Composite Configuration:**
- Strategy: Own Template
- Namespaces: `Account` (sequence 10), `Terms` (sequence 20)

**Template:**
```
ACCOUNT: {{Account.Name}}

Total Opportunities: {{= Account.Opportunities.length }}

OPPORTUNITIES
{{FOR opp IN Account.Opportunities}}
{{= Account.Opportunities.indexOf($opp) + 1 }}. {{$opp.Name}}
   Stage: {{$opp.StageName}}
   Amount: {{$opp.Amount__formatted}}
   Close Date: {{$opp.CloseDate__formatted}}
{{END-FOR opp}}

{{IF Account.Opportunities.length > 0}}
---
Total Pipeline: {{= Account.Opportunities.reduce((sum, o) => sum + (o.Amount || 0), 0).toLocaleString('en-GB', {style: 'currency', currency: 'GBP'}) }}
{{END-IF}}

---
TERMS & CONDITIONS

{{Terms.StandardTerms}}

Last Updated: {{Terms.LastModifiedDate__formatted}}
```

---

#### Example 2: Case Details with Account and Contact (Concatenate Templates)

**Composite Configuration:**
- Strategy: Concatenate Templates
- Namespaces: `Case` (sequence 10), `Account` (sequence 20), `Contact` (sequence 30)

**Template 1 - Case Details (Namespace: "Case"):**
```
SUPPORT CASE

Case Number: {{CaseNumber}}
Subject: {{Subject}}
Status: {{Status}}
Priority: {{Priority}}
Created: {{CreatedDate__formatted}}

DESCRIPTION:
{{Description}}
```

**Template 2 - Account Information (Namespace: "Account"):**
```
ACCOUNT INFORMATION

Company: {{Name}}
Industry: {{Industry}}
Phone: {{Phone}}
Website: {{Website}}

Address:
{{BillingStreet}}
{{BillingCity}}, {{BillingState}} {{BillingPostalCode}}
{{BillingCountry}}
```

**Template 3 - Contact Details (Namespace: "Contact"):**
```
CONTACT INFORMATION

Name: {{FirstName}} {{LastName}}
Title: {{Title}}
Email: {{Email}}
Phone: {{Phone}}
Mobile: {{MobilePhone}}
```

The final PDF will have all three sections with section breaks between them.

---

### Working with Cross-Namespace Data

#### Accessing Related Records Across Namespaces

In **Own Template** strategy, you can reference any namespace from anywhere:

```
Account Name: {{Account.Name}}

Primary Contact: {{Contact.Name}}
Contact Email: {{Contact.Email}}

{{IF Account.Type === 'Partner'}}
  Partner-specific terms apply (see {{Terms.PartnerTermsSection}})
{{END-IF}}
```

#### Using EXEC Blocks with Multiple Namespaces

You can combine data from multiple namespaces in JavaScript:

```
{{EXEC
const account = Account || {};
const opportunities = account.Opportunities || [];
const terms = Terms || {};

const openOpps = opportunities.filter(o =>
  o.StageName !== 'Closed Won' && o.StageName !== 'Closed Lost'
);

const totalPipeline = openOpps.reduce((sum, o) => sum + (o.Amount || 0), 0);

summary = {
  accountName: account.Name,
  openCount: openOpps.length,
  totalValue: totalPipeline,
  termsVersion: terms.Version
};
}}

EXECUTIVE SUMMARY

Customer: {{= summary.accountName }}
Open Opportunities: {{= summary.openCount }}
Pipeline Value: {{= summary.totalValue.toLocaleString('en-GB', {style: 'currency', currency: 'GBP'}) }}
Terms Version: {{= summary.termsVersion }}
```

---

### Troubleshooting Composite Documents

#### Issue: Namespace Not Found

**Problem:** `{{Account.Name}}` shows nothing in Own Template strategy

**Solutions:**
1. Verify the junction record has `Namespace__c = "Account"`
2. Check the sequence order - data providers execute in sequence
3. Confirm the SOQL query or custom provider returns data
4. Use Apex debug logs to inspect the composite envelope structure

---

#### Issue: Field Not Found in Concatenate Strategy

**Problem:** Template shows blank where field should be

**Solutions:**
1. In Concatenate Templates, **don't** use namespace prefix - access fields directly
2. Correct: `{{Name}}` (not `{{Account.Name}}`)
3. Verify the field is included in the SOQL query for that template
4. Check the namespace data in Generated_Document__c.RequestJSON__c field

---

#### Issue: Templates in Wrong Order

**Problem:** Terms appear before Account summary

**Solutions:**
1. Check `Sequence__c` values on junction records
2. Lower sequence numbers execute first (10, 20, 30, not 30, 20, 10)
3. Verify junction records are active (`IsActive__c = true`)

---

#### Issue: Namespace Collision Error

**Problem:** Error: "Duplicate namespace: Account"

**Solutions:**
1. Each junction record must have a unique `Namespace__c` value
2. Rename one namespace (e.g., "Account" and "RelatedAccount")
3. Update template to use the new namespace names

---

### Best Practices for Composite Documents

#### 1. Use Descriptive Namespace Names

**Good:**
- `Account`, `PrimaryContact`, `Terms`, `LineItems`

**Avoid:**
- `NS1`, `Data`, `Obj`

#### 2. Keep Sequences with Gaps

Use sequence numbers like 10, 20, 30 (not 1, 2, 3) to allow inserting new templates later:

```
Sequence 10: Account basics
Sequence 20: Contacts
Sequence 25: Opportunities (added later)
Sequence 30: Terms
```

#### 3. Choose Strategy Based on Reusability

- **Reusing existing templates?** → Use Concatenate Templates
- **Building from scratch?** → Use Own Template (more flexibility)

#### 4. Document Your Namespaces

Add comments to your templates documenting available namespaces:

```
<!--
Available Namespaces:
- Account: {Name, Industry, AnnualRevenue__formatted, Opportunities[]}
- Contact: {FirstName, LastName, Email, Phone}
- Terms: {StandardTerms, EffectiveDate__formatted}
-->
```

#### 5. Test with Complete Data

Ensure all namespaces have data when testing:
- Create test records with related data
- Verify each SOQL query returns results
- Test with edge cases (empty arrays, null values)

---

### See Also

For more information about composite documents:
- [Composite Template Management](composite-document-template-management.md) - Admin configuration guide
- [LWC Composite Button Guide](lwc-composite-button-guide.md) - Interactive generation from Lightning pages
- [Composite Batch Examples](composite-batch-examples.md) - Batch generation patterns
- [API Documentation](api.md) - Composite request envelope format

---

## Best Practices

### 1. Pre-format Everything in Apex

**Good:**
```apex
data.put('Amount__formatted', String.format('{0,number,currency}', amount));
```

**Avoid:**
Template-level formatting is limited. Let Apex handle it.

### 2. Use Meaningful Field Names

**Good:**
```
{{Account.BillingAddress__formatted}}
```

**Avoid:**
```
{{f1}}
```

### 3. Provide Defaults for Optional Fields

```
{{#if Account.Description}}
  {{Account.Description}}
{{else}}
  [No description]
{{/if}}
```

### 4. Test with Empty/Null Data

Ensure templates don't break when:
- Arrays are empty
- Optional fields are null
- Related objects don't exist

### 5. Keep Logic Simple

Complex calculations should be in Apex:

**Good (Apex):**
```apex
Decimal discount = isPartner ? amount * 0.15 : 0;
data.put('Discount__formatted', formatCurrency(discount));
```

**Avoid (Template):**
```
Discount: {{Amount * 0.15}}  // Don't do math in templates
```

### 6. Document Custom Fields

Add comments in template (they won't render in output):
```
<!-- Available fields: Account.Name, Account.AnnualRevenue__formatted, Account.Contacts (array) -->
```

---

## Examples

### Example 1: Simple Account Summary

**Template:**
```
ACCOUNT SUMMARY

Name: {{Account.Name}}
Industry: {{Account.Industry}}
Annual Revenue: {{Account.AnnualRevenue__formatted}}
Number of Employees: {{Account.NumberOfEmployees__formatted}}

{{#if Account.Description}}
Description:
{{Account.Description}}
{{/if}}
```

**Data:**
```json
{
  "Account": {
    "Name": "Acme Ltd",
    "Industry": "Technology",
    "AnnualRevenue__formatted": "£5,000,000",
    "NumberOfEmployees__formatted": "250",
    "Description": "Leading provider of enterprise software solutions."
  }
}
```

---

### Example 2: Opportunity with Line Items

**Template:**
```
OPPORTUNITY: {{Opportunity.Name}}

Stage: {{Opportunity.StageName}}
Amount: {{Opportunity.Amount__formatted}}
Close Date: {{Opportunity.CloseDate__formatted}}

LINE ITEMS:

{{#each Opportunity.LineItems}}
  {{@index + 1}}. {{Name}}
     Quantity: {{Quantity}}
     Unit Price: {{UnitPrice__formatted}}
     Total: {{TotalPrice__formatted}}
{{/each}}

Grand Total: {{Opportunity.Amount__formatted}}
```

**Data:**
```json
{
  "Opportunity": {
    "Name": "FY25 Renewal",
    "StageName": "Closed Won",
    "Amount__formatted": "£20,000",
    "CloseDate__formatted": "31 Dec 2025",
    "LineItems": [
      {
        "Name": "Professional Services",
        "Quantity": 40,
        "UnitPrice__formatted": "£250",
        "TotalPrice__formatted": "£10,000"
      },
      {
        "Name": "Software License",
        "Quantity": 1,
        "UnitPrice__formatted": "£10,000",
        "TotalPrice__formatted": "£10,000"
      }
    ]
  }
}
```

---

### Example 3: Conditional Partner Terms

**Template:**
```
TERMS AND CONDITIONS

{{#if Account.IsPartner}}
PARTNER TERMS

As a valued partner, you receive:
- 15% discount on all products
- Priority support
- Quarterly business reviews

{{else}}
STANDARD TERMS

Standard pricing applies.
Support available via email and phone during business hours.

{{/if}}

{{#if Account.Custom_Terms__c}}
CUSTOM TERMS:
{{Account.Custom_Terms__c}}
{{/if}}
```

---

### Example 4: Case with Contact Details

**Template:**
```
CASE DETAILS

Case Number: {{Case.CaseNumber}}
Subject: {{Case.Subject}}
Status: {{Case.Status}}
Priority: {{Case.Priority}}
Created: {{Case.CreatedDate__formatted}}

CONTACT INFORMATION

Name: {{Case.Contact.FirstName}} {{Case.Contact.LastName}}
Email: {{Case.Contact.Email}}
Phone: {{Case.Contact.Phone}}

{{#if Case.Account.Name}}
Account: {{Case.Account.Name}}
{{/if}}

DESCRIPTION:
{{Case.Description}}
```

---

## Troubleshooting

### Issue: Field Not Rendering

**Problem:** `{{Account.CustomField__c}}` shows nothing

**Solutions:**
1. Check field API name is correct (including `__c` for custom fields)
2. Verify field is included in Apex query (SOQL)
3. Check if field value is null (intentionally empty)

---

### Issue: Loop Not Working

**Problem:** `{{FOR item IN Opportunity.LineItems}}` doesn't repeat

**Solutions:**
1. Verify `LineItems` is an array in data
2. Check array isn't empty
3. Ensure `{{FOR}}` and `{{END-FOR}}` are properly paired
4. For tables, make sure both tags are in the same cell
5. Use `$item` prefix to access loop variable properties

---

### Issue: Image Not Displaying

**Problem:** `{{{Account.LogoUrl}}}` doesn't show image

**Solutions:**
1. **Base64**: Ensure format is `data:image/png;base64,<encoded-data>`
2. **External URL**: Verify domain is in `IMAGE_ALLOWLIST`
3. Use triple braces `{{{ }}}` not double `{{ }}`
4. Check image URL is valid and accessible

---

### Issue: Formatting Incorrect

**Problem:** Currency shows as `250000` instead of `£250,000.00`

**Solution:**
Use the `__formatted` field:
```
{{Opportunity.Amount__formatted}}
```

Not:
```
{{Opportunity.Amount}}
```

---

### Issue: Template Merge Fails

**Error:** "Invalid field path" or silent failure

**Solutions:**
1. Check all field references exist in data
2. Verify nested object syntax (e.g., `Opportunity.Owner.Name`)
3. Use developer console to log the exact data structure sent from Apex
4. Test template with sample data first
5. Check for syntax errors in EXEC blocks (extra `}`, missing semicolons)
6. Ensure EXEC blocks end with `}}` not `}}}`
7. Avoid line breaks inside function calls (keep on one line)

---

### Issue: JavaScript Block Not Rendering

**Problem:** `{{= expression }}` shows nothing

**Solutions:**
1. Ensure the expression returns a value (last expression is inserted)
2. Check for JavaScript errors (test in browser console first)
3. Avoid `\n` for line breaks - use FOR loops instead
4. Use EXEC for variable definition, `{{=` for output
5. Simplify IIFEs - they're usually unnecessary

**Example of common issue:**
```
BAD (won't render):
{{=
const items = ['a', 'b', 'c'];
items.map(i => i).join('\n')  // \n doesn't work!
}}

GOOD (use FOR loop):
{{EXEC
  items = ['a', 'b', 'c'];
}}
{{FOR item IN items}}
{{$item}}
{{END-FOR item}}
```

---

## Testing Templates

### 1. Create Sample Data in Apex

```apex
Map<String, Object> testData = new Map<String, Object>{
    'Account' => new Map<String, Object>{
        'Name' => 'Test Account',
        'AnnualRevenue__formatted' => '£1,000,000'
    }
};

String jsonData = JSON.serialize(testData);
System.debug(jsonData);
```

### 2. Verify Field Paths

Before creating template, confirm field paths in data:

```apex
System.debug('Account.Name: ' + data.get('Account').get('Name'));
```

### 3. Test with Edge Cases

- Empty arrays: `"LineItems": []`
- Null values: `"Description": null`
- Missing optional fields
- Very long text values

---

## Additional Resources

- **docx-templates documentation**: https://github.com/guigrpa/docx-templates
- **Salesforce Field Types**: https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/
- **Handlebars syntax**: https://handlebarsjs.com/guide/

---

## Support

For issues with templates:

1. Check this documentation first
2. Validate data structure from Apex (use `System.debug` with JSON)
3. Test with minimal template (single field)
4. Check application logs for merge errors with correlation ID

---

**Last Updated:** T-10 Implementation (2025-11-08)
