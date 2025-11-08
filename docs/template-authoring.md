# Template Authoring Guide

This guide explains how to create DOCX templates for the Salesforce PDF Generation system using `docx-templates`.

## Table of Contents

1. [Overview](#overview)
2. [Field Path Conventions](#field-path-conventions)
3. [Basic Syntax](#basic-syntax)
4. [Working with Data](#working-with-data)
5. [Loops and Arrays](#loops-and-arrays)
6. [Conditional Logic](#conditional-logic)
7. [Formatted Values](#formatted-values)
8. [Images](#images)
9. [Best Practices](#best-practices)
10. [Examples](#examples)
11. [Troubleshooting](#troubleshooting)

---

## Overview

Templates are standard Microsoft Word (.docx) files with special tags that get replaced with data from Salesforce. The system uses the `docx-templates` library with Handlebars-style syntax (`{{` and `}}`).

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

Use `{{#each}}` to iterate over arrays:

```
{{#each Opportunity.LineItems}}
  - {{Name}}: {{Quantity}} x {{UnitPrice__formatted}} = {{TotalPrice__formatted}}
{{/each}}
```

### Table Rows

Create a table in Word with a single data row containing loop tags:

| Product | Quantity | Unit Price | Total |
|---------|----------|------------|-------|
| `{{#each Opportunity.LineItems}}{{Name}}{{/each}}` | `{{Quantity}}` | `{{UnitPrice__formatted}}` | `{{TotalPrice__formatted}}` |

**Note**: Place `{{#each}}` and `{{/each}}` in the same table cell for proper row repetition.

### Accessing Parent Context

Inside loops, use `..` to access parent data:

```
{{#each Opportunity.LineItems}}
  Opportunity: {{../Opportunity.Name}}
  Product: {{Name}}
{{/each}}
```

### Loop with Index

```
{{#each Opportunity.LineItems}}
  {{@index}}. {{Name}}
{{/each}}
```

(Note: `@index` is 0-based; use expressions for 1-based: `{{@index + 1}}`)

### Empty Arrays

Check if array has items:

```
{{#if Opportunity.LineItems.length}}
  {{#each Opportunity.LineItems}}
    - {{Name}}
  {{/each}}
{{else}}
  No line items
{{/if}}
```

---

## Conditional Logic

### Basic If

```
{{#if Account.IsPartner}}
  Partner Discount: 15%
{{/if}}
```

### If-Else

```
{{#if Opportunity.IsWon}}
  Congratulations! Deal closed.
{{else}}
  Opportunity still in progress.
{{/if}}
```

### Checking for Values

```
{{#if Account.AnnualRevenue}}
  Revenue: {{Account.AnnualRevenue__formatted}}
{{else}}
  Revenue: Not disclosed
{{/if}}
```

### Multiple Conditions (AND)

docx-templates doesn't support `&&` directly. Use nested `{{#if}}`:

```
{{#if Account.IsPartner}}
  {{#if Account.IsActive}}
    Active Partner
  {{/if}}
{{/if}}
```

### Multiple Conditions (OR)

For OR logic, Apex should pre-compute a boolean field:

**Apex:**
```apex
data.put('ShouldShowDiscount', account.IsPartner || account.IsVIP);
```

**Template:**
```
{{#if ShouldShowDiscount}}
  Special discount available
{{/if}}
```

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

**Problem:** `{{#each Opportunity.LineItems}}` doesn't repeat

**Solutions:**
1. Verify `LineItems` is an array in data
2. Check array isn't empty
3. Ensure `{{#each}}` and `{{/each}}` are properly paired
4. For tables, make sure both tags are in the same cell

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

**Error:** "Invalid field path"

**Solutions:**
1. Check all field references exist in data
2. Verify nested object syntax (e.g., `Opportunity.Owner.Name`)
3. Use developer console to log the exact data structure sent from Apex
4. Test template with sample data first

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
