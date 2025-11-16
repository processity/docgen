# Lead Qualification Summary Template Specification

## Overview

**Purpose:** Lead follow-up and qualification document

**Use Case:** Generate comprehensive lead summaries for sales follow-up, handoffs, or status reviews.

**Demonstrates:**
- Lead-specific fields (Company, Status, Rating, LeadSource)
- Conditional conversion status
- Custom fields (scoring, qualification notes)
- Activity history (past and upcoming)
- Campaign tracking
- Complex conditionals with custom fields

---

## Template Content

To create this template in Microsoft Word, copy the text below and apply formatting as desired.

```
┌─────────────────────────────────────────────────────────────┐
│ LEAD QUALIFICATION SUMMARY                                  │
│ Generated: {{GeneratedDate__formatted}}                     │
└─────────────────────────────────────────────────────────────┘

LEAD INFORMATION
─────────────────────────────────────────────────────────────

Name:       {{Lead.FirstName}} {{Lead.LastName}}
Title:      {{Lead.Title}}
Company:    {{Lead.Company}}
Email:      {{Lead.Email}}
Phone:      {{Lead.Phone}}
Mobile:     {{Lead.MobilePhone}}
Website:    {{Lead.Website}}

Address:    {{Lead.Street}}
            {{Lead.City}}, {{Lead.State}} {{Lead.PostalCode}}
            {{Lead.Country}}

COMPANY PROFILE
─────────────────────────────────────────────────────────────

Industry:   {{Lead.Industry}}
Employees:  {{Lead.NumberOfEmployees__formatted}}
Revenue:    {{Lead.AnnualRevenue__formatted}}

LEAD DETAILS
─────────────────────────────────────────────────────────────

Lead Source:     {{Lead.LeadSource}}
Status:          {{Lead.Status}}
Rating:          {{Lead.Rating}}
Days Open:       {{Lead.DaysOpen__formatted}}
Created Date:    {{Lead.CreatedDate__formatted}}
Last Activity:   {{Lead.LastActivityDate__formatted}}

{{#if Lead.IsConverted}}
CONVERSION INFORMATION
─────────────────────────────────────────────────────────────

✓ LEAD HAS BEEN CONVERTED

Converted Date:     {{Lead.ConvertedDate__formatted}}
Account ID:         {{Lead.ConvertedAccountId}}
Contact ID:         {{Lead.ConvertedContactId}}
Opportunity ID:     {{Lead.ConvertedOpportunityId}}
{{else}}
STATUS: NOT YET CONVERTED
─────────────────────────────────────────────────────────────

Expected Close:     {{Lead.ExpectedCloseDate__formatted}}
Estimated Budget:   {{Lead.EstimatedBudget__formatted}}
{{/if}}

OPPORTUNITY PROFILE
─────────────────────────────────────────────────────────────

Product Interest:      {{Lead.ProductInterest}}
Current Generator:     {{Lead.CurrentGenerator}}
Primary Competitor:    {{Lead.PrimaryCompetitor}}

{{#if Lead.ScoringBreakdown}}
LEAD SCORING
─────────────────────────────────────────────────────────────

Demographic Score:   {{Lead.ScoringBreakdown.Demographic_Score__c}}/100
Engagement Score:    {{Lead.ScoringBreakdown.Engagement_Score__c}}/100
Total Score:         {{Lead.ScoringBreakdown.Total_Score__c}}
Grade:               {{Lead.ScoringBreakdown.Score_Grade__c}}
{{/if}}

ASSIGNED TO
─────────────────────────────────────────────────────────────

Sales Rep:   {{Lead.Owner.Name}}
Email:       {{Lead.Owner.Email}}
Phone:       {{Lead.Owner.Phone}}

{{#if Lead.Qualification_Notes__c}}
QUALIFICATION NOTES
─────────────────────────────────────────────────────────────

{{Lead.Qualification_Notes__c}}
{{/if}}

{{#if Lead.Description}}
DESCRIPTION
─────────────────────────────────────────────────────────────

{{Lead.Description}}
{{/if}}

{{#if Lead.RecentActivities.length}}
RECENT ACTIVITIES
─────────────────────────────────────────────────────────────

{{#each Lead.RecentActivities}}
[{{ActivityDate__formatted}}] {{Subject}} - {{Status}}
Priority: {{Priority}}
{{#if Description}}
{{Description}}
{{/if}}

{{/each}}
{{/if}}

{{#if Lead.UpcomingTasks.length}}
UPCOMING TASKS
─────────────────────────────────────────────────────────────

{{#each Lead.UpcomingTasks}}
☐ [{{ActivityDate__formatted}}] {{Subject}} - Priority: {{Priority}}
  {{Description}}

{{/each}}
{{/if}}

{{#if Lead.CampaignHistory.length}}
CAMPAIGN HISTORY
─────────────────────────────────────────────────────────────

{{#each Lead.CampaignHistory}}
• {{CampaignName}}
  Status: {{MemberStatus}} | First Responded: {{FirstRespondedDate__formatted}}

{{/each}}
{{/if}}

┌─────────────────────────────────────────────────────────────┐
│ {{ReportFooter}}                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Required SOQL Query

```sql
SELECT Id, FirstName, LastName, Name, Title, Company, Email, Phone,
       MobilePhone, Website, Street, City, State, PostalCode, Country,
       Industry, NumberOfEmployees, AnnualRevenue, LeadSource, Status,
       Rating, Description,
       Owner.Name, Owner.Email, Owner.Phone,
       CreatedDate, LastModifiedDate, LastActivityDate,
       IsConverted, ConvertedDate, ConvertedAccountId, ConvertedContactId,
       ConvertedOpportunityId,
       ProductInterest__c, CurrentGenerator__c, PrimaryCompetitor__c,
       EstimatedBudget__c, ExpectedCloseDate__c, Qualification_Notes__c,
       Demographic_Score__c, Engagement_Score__c, Total_Score__c, Score_Grade__c
FROM Lead
WHERE Id = :recordId
```

**Note:** Custom fields like `ProductInterest__c`, `Demographic_Score__c`, etc. would need to be created on the Lead object, or adjusted to match your org's schema. Activity and Campaign history would require additional Apex processing to add to the data envelope.

---

## Creating the DOCX File

### Step 1: Open Microsoft Word
- Create a new blank document

### Step 2: Set Up Page Layout
- **Margins:** 0.75" all around
- **Font:** Courier New 10pt for main content
- **Line Spacing:** 1.0

### Step 3: Create Header
1. Insert bordered text box at top
2. Add title: "LEAD QUALIFICATION SUMMARY"
3. Add generation date line
4. Apply blue background shading
5. White or light text color for contrast

### Step 4: Copy Template Content
1. Copy template text from above
2. Paste into document
3. Preserve all `{{}}` tags exactly
4. Maintain line breaks and indentation

### Step 5: Format Sections

**Section Headers** (LEAD INFORMATION, COMPANY PROFILE, etc.):
- Bold, 12pt font
- Dark blue color
- Add thin horizontal line below each header

**Field Labels** (Name:, Email:, Status:, etc.):
- Bold, 10pt
- Left-aligned
- Consistent tab stops for alignment

**Template Tags** ({{Lead.Name}}, etc.):
- Teal or dark blue color
- Monospace font (Courier New or Consolas)
- This helps distinguish from static text

### Step 6: Format Conditional Sections

The `{{#if Lead.IsConverted}}...{{else}}...{{/if}}` block shows different content based on conversion status:

**For converted leads:**
- Shows conversion date and related record IDs
- Add green checkmark: ✓ LEAD HAS BEEN CONVERTED

**For unconverted leads:**
- Shows expected close date and budget
- Displays "STATUS: NOT YET CONVERTED"

Keep both sections in template - only one will render based on data.

### Step 7: Format Arrays

**Recent Activities:**
```
[Date] Activity Subject - Status
Priority: High
Description text here
```
- Use hanging indent for multi-line entries
- Add spacing between activities

**Upcoming Tasks:**
```
☐ [Date] Task Subject - Priority: High
  Description
```
- Use checkbox character: ☐ (U+2610)
- Indent description

**Campaign History:**
```
• Campaign Name
  Status: Responded | First Responded: Date
```
- Use bullet points
- Indent details

### Step 8: Add Footer
1. Create bordered text box at bottom
2. Add `{{ReportFooter}}`
3. Match header styling

### Step 9: Save
- **File → Save As**
- **File Type:** Word Document (.docx)
- **File Name:** `Lead.docx`
- Save to: `samples/templates/`

---

## Template Configuration in Salesforce

### Step 1: Create Custom Fields (if needed)

If your org doesn't have these custom fields, create them on Lead object:

| Field API Name | Type | Description |
|----------------|------|-------------|
| ProductInterest__c | Text(255) | Product/service of interest |
| CurrentGenerator__c | Text(255) | Current solution provider |
| PrimaryCompetitor__c | Text(255) | Main competitor |
| EstimatedBudget__c | Currency | Budget allocated |
| ExpectedCloseDate__c | Date | Expected close date |
| Qualification_Notes__c | Long Text Area | Qualification notes |
| Demographic_Score__c | Number(3,0) | Demographics score 0-100 |
| Engagement_Score__c | Number(3,0) | Engagement score 0-100 |
| Total_Score__c | Formula(Number) | Demographic + Engagement |
| Score_Grade__c | Formula(Text) | Letter grade (A-F) |

Or remove these fields from the template if not needed.

### Step 2: Upload Template
1. Navigate to **Files** tab
2. Upload `Lead.docx`
3. Copy **ContentVersionId** from URL

### Step 3: Create Docgen Template Record

| Field | Value |
|-------|-------|
| **Template Name** | Lead Qualification Summary |
| **Primary Parent** | Lead |
| **Data Source** | SOQL |
| **SOQL** | Paste query from above (adjust for your fields) |
| **Template Content Version ID** | ContentVersionId from Files |
| **Store Merged DOCX** | Unchecked |
| **Return DOCX to Browser** | Unchecked |

### Step 4: Test
1. Find a Lead record with sample data
2. Populate custom fields if created
3. Generate document
4. Verify:
   - ✅ Conversion status shows correct section
   - ✅ Custom fields populate
   - ✅ Activities and tasks display (if added via Apex)
   - ✅ Scoring section appears
   - ✅ Conditionals work correctly

---

## Adding Activities and Campaigns (Advanced)

The template references `Lead.RecentActivities`, `Lead.UpcomingTasks`, and `Lead.CampaignHistory`. These require additional Apex processing since they're not simple sub-queries.

**Option 1: Add via Apex in DocgenEnvelopeService**

```apex
// In buildEnvelope() method, after base SOQL query:
List<Task> recentActivities = [
    SELECT Subject, ActivityDate, Status, Priority, Description
    FROM Task
    WHERE WhoId = :recordId
    AND Status = 'Completed'
    ORDER BY ActivityDate DESC
    LIMIT 5
];

List<Task> upcomingTasks = [
    SELECT Subject, ActivityDate, Status, Priority, Description
    FROM Task
    WHERE WhoId = :recordId
    AND Status != 'Completed'
    ORDER BY ActivityDate ASC
    LIMIT 5
];

List<CampaignMember> campaigns = [
    SELECT Campaign.Name, Status, FirstRespondedDate
    FROM CampaignMember
    WHERE LeadId = :recordId
    ORDER BY FirstRespondedDate DESC
    LIMIT 3
];

// Add to data envelope:
leadData.put('RecentActivities', recentActivities);
leadData.put('UpcomingTasks', upcomingTasks);
leadData.put('CampaignHistory', campaigns);
```

**Option 2: Simplify Template**

Remove the activity/campaign sections if not needed:
- Delete `{{#if Lead.RecentActivities.length}}...{{/if}}` block
- Delete `{{#if Lead.UpcomingTasks.length}}...{{/if}}` block
- Delete `{{#if Lead.CampaignHistory.length}}...{{/if}}` block

---

## Sample Data

Use `samples/lead.json` as reference for the expected data structure.

**Key Features Demonstrated:**
- Conditional conversion status: `{{#if Lead.IsConverted}}...{{else}}...{{/if}}`
- Custom fields: `{{Lead.ProductInterest__c}}`
- Nested objects: `{{Lead.ScoringBreakdown.Demographic_Score__c}}`
- Arrays with loops: `{{#each Lead.RecentActivities}}...{{/each}}`
- Formatted values: `{{Lead.DaysOpen__formatted}}`

---

## Troubleshooting

### Issue: Custom fields not rendering
- **Solution:** Create fields on Lead object or remove from template

### Issue: IsConverted always shows "not converted"
- **Solution:** Test with a converted lead, or verify IsConverted field in SOQL

### Issue: Activities/Tasks sections empty
- **Solution:** Add Apex processing (see "Adding Activities" above) or remove sections

### Issue: Scoring section not showing
- **Solution:** Create scoring fields or remove `{{#if Lead.ScoringBreakdown}}` block

### Issue: Days Open showing number instead of "33 days"
- **Solution:** Format in Apex:
  ```apex
  Integer daysOpen = Date.today().daysBetween(lead.CreatedDate);
  leadData.put('DaysOpen__formatted', daysOpen + ' days');
  ```

---

## Related Files

- **Sample Payload:** `samples/lead.json`
- **Template Authoring Guide:** `docs/template-authoring.md`
- **Field Path Conventions:** `docs/field-path-conventions.md`
- **Admin Guide:** `docs/ADMIN_GUIDE.md`

---

**Last Updated:** 2025-11-17 (T-11 Implementation)
