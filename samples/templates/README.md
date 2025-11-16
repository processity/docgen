# Sample DOCX Template Specifications

This directory contains detailed specifications for creating Microsoft Word templates for the Salesforce PDF Generation system.

## Available Templates

### 1. Contact Summary Template
**File:** [Contact-Template-Spec.md](./Contact-Template-Spec.md)

**Purpose:** Contact information summary document

**Demonstrates:**
- Simple field references
- Parent relationship (Contact → Account)
- Formatted values (dates, currency)
- Conditional sections
- Child relationship arrays (Cases, Opportunities)

**Complexity:** ⭐⭐ Beginner/Intermediate

---

### 2. Lead Qualification Summary Template
**File:** [Lead-Template-Spec.md](./Lead-Template-Spec.md)

**Purpose:** Lead follow-up and qualification document

**Demonstrates:**
- Lead-specific fields (Company, Status, Rating)
- Conditional conversion status (IsConverted)
- Custom fields (scoring, notes)
- Activity history arrays
- Campaign tracking

**Complexity:** ⭐⭐⭐ Intermediate

---

### 3. Asset Management Template
**File:** [Asset-Template-Spec.md](./Asset-Template-Spec.md)

**Purpose:** Comprehensive asset tracking with maintenance history

**Demonstrates:**
- Custom object fields
- Multiple parent relationships (Asset → Account, Product)
- Child relationships with sub-queries (Maintenance Records)
- Complex conditionals (warranty status, compliance)
- Financial calculations (depreciation)
- Advanced arrays and loops

**Complexity:** ⭐⭐⭐⭐ Advanced

---

## Quick Start

1. **Choose a template** from the list above
2. **Open the specification file** (e.g., `Contact-Template-Spec.md`)
3. **Review the template content** and required SOQL query
4. **Create DOCX file** in Microsoft Word:
   - Copy the template text
   - Apply formatting (headers, borders, colors)
   - Save as `.docx` file
5. **Upload to Salesforce Files** and get ContentVersionId
6. **Create Docgen Template record** with the SOQL query
7. **Test** by generating a document from a sample record

## Template Syntax Overview

All templates use **docx-templates** syntax with Handlebars-style tags:

### Simple Fields
```
{{Object.FieldName}}
{{Contact.Email}}
{{Lead.Company}}
```

### Formatted Values
```
{{Object.Field__formatted}}
{{Contact.Account.AnnualRevenue__formatted}}
{{Asset.PurchaseDate__formatted}}
```

### Parent Relationships
```
{{Object.Parent.Field}}
{{Contact.Account.Name}}
{{Asset.Product2.ProductCode}}
```

### Conditionals
```
{{#if Object.Field}}
  Show this if field has value
{{else}}
  Show this if field is null/empty
{{/if}}
```

### Child Relationships (Arrays)
```
{{#each Object.ChildRelationship}}
  {{FieldName}} - {{AnotherField__formatted}}
{{/each}}
```

### Check Array Length
```
{{#if Object.ChildRelationship.length}}
  Array has items
{{else}}
  Array is empty
{{/if}}
```

## Creating DOCX Files

### Method 1: Microsoft Word (Recommended)
1. Open Microsoft Word
2. Create new document
3. Copy template text from specification
4. Format (fonts, colors, borders, spacing)
5. Save as `.docx`

### Method 2: Google Docs + Export
1. Create in Google Docs
2. Add template tags
3. **Export as .docx** (File → Download → Microsoft Word)
4. ⚠️ Test carefully - some formatting may not convert perfectly

### Method 3: LibreOffice Writer
1. Create in LibreOffice Writer
2. Add template tags
3. Save as `.docx`
4. Verify compatibility with Microsoft Word format

## Best Practices

### ✅ Do
- Use exact Salesforce API field names
- Include all fields in SOQL query
- Test with both populated and null values
- Use `__formatted` suffix for display values
- Keep formatting simple for PDF conversion
- Add comments in template explaining complex sections

### ❌ Don't
- Use complex nested tables (may not render well)
- Rely on Word-specific features (macros, custom fonts not on server)
- Forget to close tags (`{{#if}}` needs `{{/if}}`)
- Use raw currency/date values (always use `__formatted`)
- Include external links to non-allowlisted domains

## Sample Data Files

Each template has a corresponding sample JSON payload:

- **Contact:** `samples/contact.json`
- **Lead:** `samples/lead.json`
- **Asset:** (Create based on Asset template spec)

Use these to understand the expected data structure.

## Documentation

### Complete Guides
- **[Template Authoring Guide](../../docs/template-authoring.md)** - Full syntax reference and examples
- **[Field Path Conventions](../../docs/field-path-conventions.md)** - Data structure and naming rules
- **[Admin Guide](../../docs/ADMIN_GUIDE.md)** - How to add new objects and configure templates

### Quick References
- **[Admin Runbook](../../docs/ADMIN_RUNBOOK.md)** - Operational procedures and troubleshooting
- **[Migration Guide](../../docs/MIGRATION_GUIDE.md)** - Upgrade information

## Customization Tips

### Branding
- Add your company logo (as base64 or allowlisted URL)
- Use your brand colors in headers/sections
- Customize footer with company information

### Layout
- Adjust margins for your printer/PDF viewer
- Use consistent spacing between sections
- Add page numbers for multi-page documents

### Localization
- Apex handles date/currency formatting based on user locale
- Template can include locale-specific text
- Use conditionals for multi-language support

## Troubleshooting

### Template Tag Not Rendering
- **Check:** Field is in SOQL query
- **Check:** Field API name is exact match (case-sensitive)
- **Check:** Field has a value (not null)

### Conditional Section Always Shows/Hides
- **Check:** Syntax: `{{#if Field}}...{{/if}}`
- **Check:** Field has truthy value
- **Check:** Closing tag matches opening tag

### Loop Not Working
- **Check:** Sub-query in SOQL returns array
- **Check:** Syntax: `{{#each Array}}...{{/each}}`
- **Check:** Array has items

### PDF Looks Different Than Word
- **Expected:** LibreOffice rendering may differ slightly
- **Solution:** Use simple formatting, test early, iterate

## Support

For issues with templates:
1. Check specification file for requirements
2. Review [Template Authoring Guide](../../docs/template-authoring.md)
3. Consult [Admin Runbook](../../docs/ADMIN_RUNBOOK.md) troubleshooting section
4. Verify SOQL query includes all referenced fields

---

**Last Updated:** 2025-11-17 (T-11 Implementation)

**Ready to Start?** Choose a template specification above and begin creating your custom document templates!
