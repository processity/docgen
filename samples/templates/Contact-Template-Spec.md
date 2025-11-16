# Contact Summary Template Specification

## Overview

**Purpose:** Contact information summary document

**Use Case:** Generate professional contact summaries for meetings, proposals, or records management.

**Demonstrates:**
- Simple Contact fields (Name, Email, Phone, Title)
- Parent relationship (Contact → Account)
- Formatted addresses
- Conditional sections for missing data
- Recent Cases and Opportunities arrays

---

## Template Content

To create this template in Microsoft Word, copy the text below and apply formatting as desired.

```
┌─────────────────────────────────────────────────────────────┐
│ CONTACT SUMMARY                                             │
│ Generated: {{GeneratedDate__formatted}}                     │
└─────────────────────────────────────────────────────────────┘

CONTACT INFORMATION
─────────────────────────────────────────────────────────────

Name:       {{Contact.FirstName}} {{Contact.LastName}}
Title:      {{Contact.Title}}
Email:      {{Contact.Email}}
Phone:      {{Contact.Phone}}
{{#if Contact.MobilePhone}}
Mobile:     {{Contact.MobilePhone}}
{{/if}}
Department: {{Contact.Department}}

MAILING ADDRESS
─────────────────────────────────────────────────────────────

{{Contact.MailingStreet}}
{{Contact.MailingCity}}, {{Contact.MailingPostalCode}}
{{Contact.MailingCountry}}

{{#if Contact.Account.Name}}
ACCOUNT INFORMATION
─────────────────────────────────────────────────────────────

Company:    {{Contact.Account.Name}}
Industry:   {{Contact.Account.Industry}}
Location:   {{Contact.Account.BillingCity}}, {{Contact.Account.BillingCountry}}
Revenue:    {{Contact.Account.AnnualRevenue__formatted}}
Phone:      {{Contact.Account.Phone}}
Website:    {{Contact.Account.Website}}
{{/if}}

{{#if Contact.ReportsTo.Name}}
REPORTS TO
─────────────────────────────────────────────────────────────

Name:       {{Contact.ReportsTo.Name}}
Title:      {{Contact.ReportsTo.Title}}
Email:      {{Contact.ReportsTo.Email}}
{{/if}}

ACCOUNT MANAGER
─────────────────────────────────────────────────────────────

Name:       {{Contact.Owner.Name}}
Email:      {{Contact.Owner.Email}}
Phone:      {{Contact.Owner.Phone}}

{{#if Contact.RecentCases.length}}
RECENT CASES
─────────────────────────────────────────────────────────────

{{#each Contact.RecentCases}}
Case {{CaseNumber}}: {{Subject}}
Status: {{Status}} | Priority: {{Priority}} | Closed: {{ClosedDate__formatted}}

{{/each}}
{{/if}}

{{#if Contact.RecentOpportunities.length}}
RECENT OPPORTUNITIES
─────────────────────────────────────────────────────────────

{{#each Contact.RecentOpportunities}}
• {{Name}} - {{StageName}}
  Amount: {{Amount__formatted}} | Close Date: {{CloseDate__formatted}}
  Probability: {{Probability__formatted}}

{{/each}}
{{/if}}

RECORD DETAILS
─────────────────────────────────────────────────────────────

Created:         {{Contact.CreatedDate__formatted}}
Last Modified:   {{Contact.LastModifiedDate__formatted}}
Last Activity:   {{Contact.LastActivityDate__formatted}}

{{#if Contact.Description}}
NOTES
─────────────────────────────────────────────────────────────

{{Contact.Description}}
{{/if}}

┌─────────────────────────────────────────────────────────────┐
│ {{ReportFooter}}                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Required SOQL Query

```sql
SELECT Id, FirstName, LastName, Name, Title, Email, Phone, MobilePhone,
       Department, MailingStreet, MailingCity, MailingPostalCode,
       MailingCountry, Description,
       Account.Name, Account.Industry, Account.BillingCity,
       Account.BillingCountry, Account.AnnualRevenue, Account.Phone,
       Account.Website,
       ReportsTo.Name, ReportsTo.Title, ReportsTo.Email,
       Owner.Name, Owner.Email, Owner.Phone,
       CreatedDate, LastModifiedDate, LastActivityDate,
       (SELECT CaseNumber, Subject, Status, Priority, ClosedDate
        FROM Cases ORDER BY ClosedDate DESC LIMIT 3),
       (SELECT Name, StageName, Amount, CloseDate, Probability
        FROM Opportunities ORDER BY CloseDate DESC LIMIT 3)
FROM Contact
WHERE Id = :recordId
```

---

## Creating the DOCX File

### Step 1: Open Microsoft Word
- Create a new blank document

### Step 2: Set Up Page Layout
- **Margins:** 0.75" all around (File → Page Setup)
- **Font:** Courier New or Consolas 10pt (for clean monospace look)
- **Line Spacing:** 1.0

### Step 3: Add Header Section
1. Create a bordered text box at top of page
2. Add centered text: "CONTACT SUMMARY"
3. Add second line: "Generated: {{GeneratedDate__formatted}}"
4. Apply shading (light gray background)
5. Use Bold font for title

### Step 4: Copy Template Content
1. Copy the template text from above (excluding the boxes)
2. Paste into Word document
3. Preserve all `{{}}` tags exactly as shown
4. Keep line spacing consistent

### Step 5: Format Sections
- **Section Headers** (CONTACT INFORMATION, etc.):
  - Bold
  - Slightly larger font (11-12pt)
  - Add horizontal line below (Insert → Shapes → Line)

- **Field Labels** (Name:, Email:, etc.):
  - Regular weight
  - Align labels in a consistent column

- **Field Values** ({{Contact.Name}}, etc.):
  - Keep template tags in monospace font
  - Color: Dark blue or teal (helps distinguish from static text)

### Step 6: Add Footer
1. Create bordered text box at bottom
2. Add: `{{ReportFooter}}`
3. Match header styling

### Step 7: Test Conditional Sections
- The `{{#if}}...{{/if}}` blocks will show/hide sections based on data
- Keep these blocks intact with proper indentation
- Test with both populated and empty data

### Step 8: Save
- **File → Save As**
- **File Type:** Word Document (.docx)
- **File Name:** `Contact.docx`
- Save to this directory: `samples/templates/`

---

## Template Configuration in Salesforce

### Step 1: Upload Template
1. Navigate to **Files** tab in Salesforce
2. Click **Upload Files**
3. Select `Contact.docx`
4. After upload, open the file
5. Copy the **ContentVersionId** from URL (18-char ID starting with '068')

### Step 2: Create Docgen Template Record
1. Navigate to **Docgen Templates** tab
2. Click **New**
3. Fill in fields:

| Field | Value |
|-------|-------|
| **Template Name** | Contact Summary |
| **Primary Parent** | Contact |
| **Data Source** | SOQL |
| **SOQL** | Paste query from above |
| **Template Content Version ID** | Paste ContentVersionId from Files |
| **Store Merged DOCX** | Unchecked |
| **Return DOCX to Browser** | Unchecked (PDF default) |

4. Click **Save**

### Step 3: Test
1. Create or find a Contact record with sample data
2. Generate document (via LWC button or Apex)
3. Verify:
   - ✅ All fields populate correctly
   - ✅ Formatted values display properly
   - ✅ Conditional sections show/hide as expected
   - ✅ Arrays (Cases, Opportunities) iterate correctly
   - ✅ PDF is professional and readable

---

## Sample Data

Use `samples/contact.json` as reference for the expected data structure.

**Key Features Demonstrated:**
- Simple field replacement: `{{Contact.Name}}`
- Parent relationship: `{{Contact.Account.Name}}`
- Formatted values: `{{Contact.Account.AnnualRevenue__formatted}}`
- Conditionals: `{{#if Contact.MobilePhone}}...{{/if}}`
- Arrays: `{{#each Contact.RecentCases}}...{{/each}}`

---

## Troubleshooting

### Issue: Field not rendering
- **Check:** Field is in SOQL query
- **Check:** Field API name matches exactly (case-sensitive)
- **Check:** Field has a value (not null)

### Issue: Conditional section always shows/hides
- **Check:** Conditional syntax: `{{#if Field}}...{{/if}}`
- **Check:** Field has truthy value (not null, not empty string)
- **Check:** Closing tag matches opening tag

### Issue: Array not repeating
- **Check:** Array field in SOQL (sub-query)
- **Check:** Syntax: `{{#each Array}}...{{/each}}`
- **Check:** Array has items (not empty)

### Issue: Formatting looks wrong in PDF
- **Check:** LibreOffice rendering may differ from Word
- **Check:** Use simple formatting (avoid complex tables/images)
- **Check:** Test with sample data first

---

## Related Files

- **Sample Payload:** `samples/contact.json`
- **Template Authoring Guide:** `docs/template-authoring.md`
- **Field Path Conventions:** `docs/field-path-conventions.md`
- **Admin Guide:** `docs/ADMIN_GUIDE.md`

---

**Last Updated:** 2025-11-17 (T-11 Implementation)
