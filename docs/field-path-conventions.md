# Field Path Conventions

This document describes the field path conventions used in document generation templates and data envelopes.

## Overview

The document generation system uses **Salesforce API-style naming** for field paths in both:
- The **data envelope** (JSON passed from Apex to Node)
- The **template placeholders** (DOCX template tags using docx-templates syntax)

This convention ensures consistency, predictability, and alignment with Salesforce's standard field naming.

---

## Field Path Structure

### Basic Field Access

Field paths follow the pattern: `Object.FieldName`

**Examples:**
- `Account.Name` → Account's Name field
- `Opportunity.StageName` → Opportunity's Stage field
- `Case.CaseNumber` → Case number

### Relationship Traversal

For parent relationships, use dot notation: `Object.ParentRelationship.FieldName`

**Examples:**
- `Opportunity.Account.Name` → Parent Account's Name via Opportunity
- `Case.Contact.Email` → Related Contact's Email via Case
- `Opportunity.Owner.Name` → Opportunity Owner's Name

### Custom Fields

Custom fields follow Salesforce API naming with `__c` suffix:

**Examples:**
- `Account.CustomField__c`
- `Opportunity.ProjectStartDate__c`
- `Case.EscalationReason__c`

---

## Formatted Display Values

### The `__formatted` Convention

To separate **raw data** from **display values**, the system uses a `__formatted` suffix for fields that require locale-specific formatting.

**Why?**
- **Deterministic templates**: All formatting logic is handled by Apex
- **Locale consistency**: Formatting matches user's Salesforce locale/timezone settings
- **Simplified templates**: No complex formatting expressions in DOCX

### When to Use `__formatted`

Use the `__formatted` suffix for:

| Field Type | Example Raw | Example Formatted |
|------------|-------------|-------------------|
| **Currency** | `Account.AnnualRevenue` | `Account.AnnualRevenue__formatted` → `"£1,200,000"` |
| **Number** | `Opportunity.Probability` | `Opportunity.Probability__formatted` → `"75%"` |
| **Date** | `Opportunity.CloseDate` | `Opportunity.CloseDate__formatted` → `"31 Dec 2025"` |
| **DateTime** | `Case.CreatedDate` | `Case.CreatedDate__formatted` → `"5 Nov 2025, 14:30"` |
| **Percent** | `Opportunity.DiscountPercent` | `Opportunity.DiscountPercent__formatted` → `"10%"` |

**Apex Responsibility:**
Apex's `DocgenEnvelopeService` computes all `__formatted` fields using:
- User's locale (e.g., `en-GB`, `en-US`, `de-DE`)
- User's timezone (e.g., `Europe/London`, `America/New_York`)
- Salesforce's standard formatting functions

**Template Usage:**
```
Account Annual Revenue: {{Account.AnnualRevenue__formatted}}
Close Date: {{Opportunity.CloseDate__formatted}}
Created: {{Case.CreatedDate__formatted}}
```

---

## Arrays and Collections

### Child Relationships

Child relationships (one-to-many) are represented as **arrays**.

**Examples:**
- `Opportunity.LineItems` → Array of OpportunityLineItem records
- `Account.Contacts` → Array of Contact records
- `Case.Comments` → Array of CaseComment records

### Accessing Array Elements

In **docx-templates**, use `{{#each}}` blocks to iterate:

```handlebars
{{#each Opportunity.LineItems}}
  Product: {{Name}}
  Quantity: {{Quantity__formatted}}
  Price: {{UnitPrice__formatted}}
  Total: {{TotalPrice__formatted}}
{{/each}}
```

### Nested Arrays

For nested structures:

```handlebars
{{#each Account.Opportunities}}
  Opportunity: {{Name}} ({{Amount__formatted}})

  Line Items:
  {{#each LineItems}}
    - {{ProductName}}: {{Quantity}} x {{UnitPrice__formatted}}
  {{/each}}
{{/each}}
```

---

## Conditional Logic

### Using `{{#if}}`

Templates support conditional blocks for optional sections:

```handlebars
{{#if Account.IsPartner}}
  Partner Terms Apply
  Discount: {{Account.PartnerDiscount__formatted}}
{{/if}}

{{#if Opportunity.IsClosed}}
  Status: Closed
  Closed Date: {{CloseDate__formatted}}
{{else}}
  Status: Open
  Expected Close: {{CloseDate__formatted}}
{{/if}}
```

### Boolean Field Paths

Salesforce checkbox fields map to booleans:
- `Account.IsPartner` → `true` or `false`
- `Case.IsCritical` → `true` or `false`
- `Opportunity.IsWon` → `true` or `false`

---

## Computed Values

### Apex-Precomputed Fields

For complex calculations or aggregations, **Apex should precompute** the values and include them in the data envelope.

**Why?**
- **Deterministic**: Same inputs → same output
- **Testable**: Logic is in Apex unit tests, not hidden in templates
- **Performant**: No runtime computation in Node/docx-templates

**Example:**

```apex
// In DocgenEnvelopeService
data.put('Opportunity', new Map<String, Object>{
  'Name' => opp.Name,
  'TotalAmount__formatted' => formatCurrency(opp.Amount, locale),
  'TaxAmount__formatted' => formatCurrency(opp.Amount * 0.20, locale),
  'GrandTotal__formatted' => formatCurrency(opp.Amount * 1.20, locale)
});
```

**Template:**
```handlebars
Subtotal: {{Opportunity.TotalAmount__formatted}}
VAT (20%): {{Opportunity.TaxAmount__formatted}}
Grand Total: {{Opportunity.GrandTotal__formatted}}
```

### Simple Inline Expressions

For **very simple** operations, docx-templates supports inline JavaScript:

```handlebars
Total Items: {{Opportunity.LineItems.length}}
Average: {{Opportunity.TotalAmount / Opportunity.LineItems.length}}
```

**⚠️ Use sparingly!** Prefer Apex precomputation for anything beyond trivial math.

---

## Images

### Base64-Encoded Images (Preferred)

For logos, signatures, or small images, **embed as base64** in the data envelope:

**Apex:**
```apex
String logoBase64 = 'data:image/png;base64,' + EncodingUtil.base64Encode(logoBlob);
data.put('Company', new Map<String, Object>{
  'Logo__base64' => logoBase64
});
```

**Template:**
```handlebars
{{{Company.Logo__base64}}}
```

**Note:** Use triple braces `{{{ }}}` for unescaped output.

### External Image URLs (Allowlisted)

If the image is hosted externally, the URL **must be allowlisted** in the Node service configuration.

**Environment Variable:**
```
IMAGE_ALLOWLIST=cdn.example.com,images.company.com
```

**Data:**
```json
{
  "Company": {
    "LogoURL": "https://cdn.example.com/logo.png"
  }
}
```

**Template:**
```handlebars
{{{Company.LogoURL}}}
```

**Security:** Non-allowlisted URLs will fail with a clear error message.

---

## Null Handling

### Null vs. Empty String

Salesforce fields can be:
- `null` (not set)
- Empty string `""` (set but blank)

**Template Behavior:**
- `{{Field}}` renders `null` as empty string
- `{{#if Field}}` evaluates `null` and `""` as falsy

### Safe Access with Defaults

Use `{{#if}}` to provide fallbacks:

```handlebars
{{#if Account.Phone}}
  Phone: {{Account.Phone}}
{{else}}
  Phone: Not provided
{{/if}}
```

Or inline:

```handlebars
Phone: {{Account.Phone}} (if null, shows empty)
```

---

## Namespace-Scoped Field Paths (Composite Documents)

Namespaces prevent field collisions when combining multiple data sources. Syntax differs by strategy:

**Own Template**: Use `{{Namespace.Field}}` syntax. Data structure: `{Account: {...}, Terms: {...}}`. Cross-namespace references allowed.

**Concatenate Templates**: Use `{{Field}}` syntax (no prefix). Each template receives only its namespace data.

**Common Issues**:
- Own Template blank field → Check using `{{Namespace.Field}}` not `{{Field}}`
- Concatenate blank field → Check using `{{Field}}` not `{{Namespace.Field}}`
- Namespace collision → Ensure unique `Namespace__c` values in junction records

**Naming**: Use singular PascalCase (e.g., `Account`, `Terms`, `PaymentSchedule`). Avoid special chars, plural forms, snake_case.

**See**: [Template Authoring](./template-authoring.md#composite-documents)

---

## Naming Rules Summary

| Element | Convention | Example |
|---------|------------|---------|
| **Standard Field** | `Object.FieldName` | `Account.Name` |
| **Custom Field** | `Object.FieldName__c` | `Account.ProjectCode__c` |
| **Formatted Value** | `Object.FieldName__formatted` | `Opportunity.Amount__formatted` |
| **Parent Relationship** | `Object.Parent.Field` | `Opportunity.Account.Name` |
| **Child Relationship** | `Object.Children` (array) | `Account.Contacts` |
| **Computed Value** | `Object.ComputedName__formatted` | `Opportunity.TaxAmount__formatted` |
| **Boolean** | `Object.IsCondition` | `Account.IsPartner` |

---

## Best Practices

### 1. Always Use `__formatted` for Display

❌ **Bad:**
```handlebars
Amount: {{Opportunity.Amount}}
```
Result: `Amount: 250000` (raw number)

✅ **Good:**
```handlebars
Amount: {{Opportunity.Amount__formatted}}
```
Result: `Amount: £250,000` (locale-formatted)

### 2. Precompute Complex Logic in Apex

❌ **Bad:**
```handlebars
{{#if (and Opportunity.IsWon (gt Opportunity.Amount 100000))}}
  Large Win!
{{/if}}
```
Complexity hidden in template; hard to test.

✅ **Good:**

**Apex:**
```apex
data.put('Opportunity', new Map<String, Object>{
  'IsLargeWin' => opp.IsWon && opp.Amount > 100000
});
```

**Template:**
```handlebars
{{#if Opportunity.IsLargeWin}}
  Large Win!
{{/if}}
```

### 3. Document Custom Computed Fields

For any non-standard field (not from SOQL), add a comment:

```apex
// Custom computed field: checks if opportunity is high-value renewal
data.put('IsHighValueRenewal', opp.Type == 'Renewal' && opp.Amount > 500000);
```

### 4. Keep Templates Deterministic

**Avoid:**
- Current date/time lookups in templates (use `GeneratedDate__formatted` from Apex)
- Random values or UUIDs
- External API calls

**Why?** Same data → same document. Enables testing and idempotency.

---

## Examples from Samples

### Account Summary (`samples/account.json`)

**Field Paths Used:**
- `Account.Name`
- `Account.AnnualRevenue__formatted`
- `Account.Contacts` (array)
- `Account.Owner.Name` (relationship)

**Template Snippet:**
```handlebars
Company: {{Account.Name}}
Annual Revenue: {{Account.AnnualRevenue__formatted}}
Account Manager: {{Account.Owner.Name}}

Key Contacts:
{{#each Account.Contacts}}
  - {{Name}}, {{Title}} ({{Email}})
{{/each}}
```

### Opportunity Quote (`samples/opportunity.json`)

**Field Paths Used:**
- `Opportunity.Name`
- `Opportunity.LineItems` (array)
- `Opportunity.TotalAmount__formatted`
- `Account.Name` (via parent)

**Template Snippet:**
```handlebars
Quote for: {{Opportunity.Name}}
Customer: {{Account.Name}}

Line Items:
{{#each Opportunity.LineItems}}
  {{ProductCode}} - {{Name}}
  Quantity: {{Quantity__formatted}} x {{UnitPrice__formatted}}
  Total: {{TotalPrice__formatted}}
{{/each}}

Grand Total: {{Opportunity.TotalAmount__formatted}}
```

### Case Report (`samples/case.json`)

**Field Paths Used:**
- `Case.CaseNumber`
- `Case.Comments` (array)
- `Case.CreatedDate__formatted`
- `Contact.Name` (relationship)

**Template Snippet:**
```handlebars
Case #{{Case.CaseNumber}}
Reported by: {{Contact.Name}} ({{Contact.Email}})
Created: {{Case.CreatedDate__formatted}}

Comments:
{{#each Case.Comments}}
  [{{CreatedDate__formatted}}] {{CreatedBy}}:
  {{Body}}
{{/each}}
```

---

## Validation

### Schema Validation (Node)

The `/generate` endpoint validates:
- `templateId` is present and non-empty
- `data` is an object (structure is flexible)
- Required envelope fields present

**No deep validation** of field paths—templates are flexible.

### Runtime Errors

If a template references a missing field:
- **docx-templates** will render it as empty string (by default)
- **Node logs** a warning (in non-prod)
- **Production**: no error thrown (graceful degradation)

To catch missing fields early, **test templates** with sample data in a Sandbox.

---

## Related Documentation

- [Template Authoring Guide](./template-authoring.md) — Full guide to creating DOCX templates
- [ADR-0004: Caching & Idempotency](./adr/0004-caching.md) — Why templates are immutable
- [OpenAPI Specification](../openapi.yaml) — Full API schema
- [Development Context](../development-context.md) — System overview

---

## Questions?

If you're unsure about a field path:
1. Check the **Salesforce Object** (Schema Builder or Setup)
2. Verify the **API name** (not the Label)
3. Use `__formatted` for display values
4. Precompute complex logic in Apex

**Golden Rule:** If it's in Salesforce's API, use the API name. If it's computed, document it clearly in Apex.
