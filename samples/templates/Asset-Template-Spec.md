# Asset Management Template Specification

## Overview

**Purpose:** Asset management and maintenance tracking document

**Use Case:** Generate comprehensive asset summaries including purchase details, specifications, warranty information, and complete maintenance history.

**Demonstrates:**
- Custom object fields
- Multiple parent relationships (Asset → Account, Asset → Product)
- Child relationships with sub-queries (Asset → Maintenance Records)
- Complex conditionals (warranty status, compliance)
- Table formatting for child records
- Financial calculations (depreciation)

---

## Template Content

To create this template in Microsoft Word, copy the text below and apply formatting as desired.

```
┌─────────────────────────────────────────────────────────────┐
│ ASSET SUMMARY REPORT                                        │
│ Generated: {{GeneratedDate__formatted}}                     │
└─────────────────────────────────────────────────────────────┘

ASSET INFORMATION
─────────────────────────────────────────────────────────────

Asset Name:          {{Asset.Name}}
Serial Number:       {{Asset.SerialNumber}}
Asset Tag:           {{Asset.AssetTag__c}}
Status:              {{Asset.Status}}

{{#if Asset.Status == 'Installed'}}
✓ ASSET IS CURRENTLY ACTIVE AND INSTALLED
{{else}}
⚠ ASSET STATUS: {{Asset.Status}}
{{/if}}

PURCHASE DETAILS
─────────────────────────────────────────────────────────────

Purchase Date:       {{Asset.PurchaseDate__formatted}}
Purchase Price:      {{Asset.Price__formatted}}
Supplier:            {{Asset.Supplier__c}}
Purchase Order:      {{Asset.PurchaseOrder__c}}

WARRANTY INFORMATION
─────────────────────────────────────────────────────────────

Warranty Start:      {{Asset.WarrantyStartDate__c__formatted}}
Warranty End:        {{Asset.WarrantyEndDate__c__formatted}}
Warranty Terms:      {{Asset.WarrantyTerms__c}}

{{#if Asset.IsUnderWarranty__c}}
✓ THIS ASSET IS CURRENTLY UNDER WARRANTY
{{else}}
⚠ WARRANTY HAS EXPIRED
{{/if}}

{{#if Asset.Account.Name}}
ACCOUNT INFORMATION
─────────────────────────────────────────────────────────────

Account Name:        {{Asset.Account.Name}}
Account Number:      {{Asset.Account.AccountNumber}}
Industry:            {{Asset.Account.Industry}}
Location:            {{Asset.Account.BillingCity}}, {{Asset.Account.BillingCountry}}
Account Phone:       {{Asset.Account.Phone}}
Account Website:     {{Asset.Account.Website}}
{{/if}}

{{#if Asset.Product2.Name}}
PRODUCT INFORMATION
─────────────────────────────────────────────────────────────

Product Name:        {{Asset.Product2.Name}}
Product Code:        {{Asset.Product2.ProductCode}}
Product Family:      {{Asset.Product2.Family}}
Description:         {{Asset.Product2.Description}}
{{/if}}

{{#if Asset.Location__c}}
ASSET LOCATION
─────────────────────────────────────────────────────────────

Location:            {{Asset.Location__c}}
Building:            {{Asset.Building__c}}
Floor:               {{Asset.Floor__c}}
Room:                {{Asset.Room__c}}
Coordinates:         {{Asset.GPSCoordinates__c}}
{{/if}}

TECHNICAL SPECIFICATIONS
─────────────────────────────────────────────────────────────

Model:               {{Asset.Model__c}}
Manufacturer:        {{Asset.Manufacturer__c}}
Year:                {{Asset.ManufactureYear__c}}
Specifications:      {{Asset.TechnicalSpecs__c}}

USAGE INFORMATION
─────────────────────────────────────────────────────────────

Install Date:        {{Asset.InstallDate__formatted}}
Usage Metric:        {{Asset.UsageMetric__c}}
Current Usage:       {{Asset.CurrentUsage__c__formatted}}
Usage Limit:         {{Asset.UsageLimit__c__formatted}}
Utilization Rate:    {{Asset.UtilizationRate__c}}%

{{#if Asset.MaintenanceRecords__r.length}}
MAINTENANCE HISTORY
─────────────────────────────────────────────────────────────

{{#each Asset.MaintenanceRecords__r}}
Date: {{CompletedDate__formatted}}
Type: {{MaintenanceType__c}}
Technician: {{Technician__c}}
Cost: {{Cost__c__formatted}}
Description: {{Description__c}}
{{#if NextScheduledDate__c}}
Next Scheduled: {{NextScheduledDate__c__formatted}}
{{/if}}
Status: {{Status__c}}
───────────────────────────────────────────────

{{/each}}

Total Maintenance Cost: {{Asset.TotalMaintenanceCost__c__formatted}}
Last Maintenance Date:  {{Asset.LastMaintenanceDate__c__formatted}}
Next Scheduled Service: {{Asset.NextScheduledService__c__formatted}}
{{else}}
No maintenance records on file.
{{/if}}

{{#if Asset.UpcomingMaintenanceTasks__r.length}}
SCHEDULED MAINTENANCE
─────────────────────────────────────────────────────────────

{{#each Asset.UpcomingMaintenanceTasks__r}}
☐ [{{ScheduledDate__c__formatted}}] {{TaskType__c}}
  Description: {{Description__c}}
  Estimated Cost: {{EstimatedCost__c__formatted}}

{{/each}}
{{/if}}

ASSET OWNER & CONTACTS
─────────────────────────────────────────────────────────────

Asset Owner:         {{Asset.Owner.Name}}
Email:               {{Asset.Owner.Email}}
Phone:               {{Asset.Owner.Phone}}

{{#if Asset.PrimaryContact__r.Name}}
Primary Contact:     {{Asset.PrimaryContact__r.Name}}
Contact Email:       {{Asset.PrimaryContact__r.Email}}
Contact Phone:       {{Asset.PrimaryContact__r.Phone}}
{{/if}}

COMPLIANCE & CERTIFICATIONS
─────────────────────────────────────────────────────────────

Compliance Status:   {{Asset.ComplianceStatus__c}}
Certifications:      {{Asset.Certifications__c}}
Last Inspection:     {{Asset.LastInspectionDate__c__formatted}}
Next Inspection:     {{Asset.NextInspectionDate__c__formatted}}

{{#if Asset.ComplianceNotes__c}}
Compliance Notes:
{{Asset.ComplianceNotes__c}}
{{/if}}

DEPRECIATION DETAILS
─────────────────────────────────────────────────────────────

Original Value:      {{Asset.Price__formatted}}
Current Value:       {{Asset.CurrentValue__c__formatted}}
Depreciation:        {{Asset.DepreciationAmount__c__formatted}} ({{Asset.DepreciationRate__c}}%)
Useful Life:         {{Asset.UsefulLifeMonths__c}} months
Remaining Life:      {{Asset.RemainingLifeMonths__c}} months

{{#if Asset.Notes__c}}
ADDITIONAL NOTES
─────────────────────────────────────────────────────────────

{{Asset.Notes__c}}
{{/if}}

RECORD DETAILS
─────────────────────────────────────────────────────────────

Record Created:      {{Asset.CreatedDate__formatted}}
Created By:          {{Asset.CreatedBy.Name}}
Last Modified:       {{Asset.LastModifiedDate__formatted}}
Modified By:         {{Asset.LastModifiedBy.Name}}

┌─────────────────────────────────────────────────────────────┐
│ {{ReportFooter}}                                            │
│ Asset ID: {{Asset.Id}}                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Required SOQL Query

```sql
SELECT Id, Name, SerialNumber, Status, AssetTag__c, PurchaseDate, Price,
       Supplier__c, PurchaseOrder__c, WarrantyStartDate__c, WarrantyEndDate__c,
       WarrantyTerms__c, IsUnderWarranty__c,
       Account.Name, Account.AccountNumber, Account.Industry,
       Account.BillingCity, Account.BillingCountry, Account.Phone, Account.Website,
       Product2.Name, Product2.ProductCode, Product2.Family, Product2.Description,
       Location__c, Building__c, Floor__c, Room__c, GPSCoordinates__c,
       Model__c, Manufacturer__c, ManufactureYear__c, TechnicalSpecs__c,
       InstallDate, UsageMetric__c, CurrentUsage__c, UsageLimit__c, UtilizationRate__c,
       TotalMaintenanceCost__c, LastMaintenanceDate__c, NextScheduledService__c,
       Owner.Name, Owner.Email, Owner.Phone,
       PrimaryContact__r.Name, PrimaryContact__r.Email, PrimaryContact__r.Phone,
       ComplianceStatus__c, Certifications__c, LastInspectionDate__c, NextInspectionDate__c,
       ComplianceNotes__c, CurrentValue__c, DepreciationAmount__c, DepreciationRate__c,
       UsefulLifeMonths__c, RemainingLifeMonths__c, Notes__c,
       CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name,
       (SELECT CompletedDate, MaintenanceType__c, Technician__c, Cost__c,
               Description__c, NextScheduledDate__c, Status__c
        FROM MaintenanceRecords__r
        ORDER BY CompletedDate DESC),
       (SELECT ScheduledDate__c, TaskType__c, Description__c, EstimatedCost__c
        FROM UpcomingMaintenanceTasks__r
        WHERE ScheduledDate__c >= TODAY
        ORDER BY ScheduledDate__c ASC)
FROM Asset
WHERE Id = :recordId
```

**⚠️ Important:** This template assumes custom fields and child objects. You'll need to adjust based on your org's schema or create these fields/objects.

---

## Custom Schema Requirements

### Standard Asset Fields (Available)
- Id, Name, SerialNumber, Status, PurchaseDate, Price
- InstallDate, UsageEndDate
- AccountId (→ Account relationship)
- Product2Id (→ Product2 relationship)
- ContactId (→ Contact relationship for PrimaryContact)

### Custom Fields to Create on Asset

| Field API Name | Type | Description |
|----------------|------|-------------|
| AssetTag__c | Text(50) | Physical asset tag number |
| Supplier__c | Text(255) | Supplier/vendor name |
| PurchaseOrder__c | Text(50) | Purchase order number |
| WarrantyStartDate__c | Date | Warranty start date |
| WarrantyEndDate__c | Date | Warranty end date |
| WarrantyTerms__c | Long Text Area | Warranty terms text |
| IsUnderWarranty__c | Formula(Checkbox) | `WarrantyEndDate__c >= TODAY` |
| Location__c | Text(255) | Physical location |
| Building__c | Text(100) | Building name/number |
| Floor__c | Text(50) | Floor number |
| Room__c | Text(50) | Room number |
| GPSCoordinates__c | Geolocation | GPS coordinates |
| Model__c | Text(100) | Model number |
| Manufacturer__c | Text(100) | Manufacturer name |
| ManufactureYear__c | Number(4,0) | Year manufactured |
| TechnicalSpecs__c | Long Text Area | Technical specifications |
| UsageMetric__c | Text(50) | Usage unit (hours, cycles, etc) |
| CurrentUsage__c | Number(18,2) | Current usage value |
| UsageLimit__c | Number(18,2) | Usage limit before service |
| UtilizationRate__c | Percent | Utilization percentage |
| TotalMaintenanceCost__c | Roll-Up Summary(Currency) | Sum of maintenance costs |
| LastMaintenanceDate__c | Formula(Date) | MAX(MaintenanceRecords.CompletedDate) |
| NextScheduledService__c | Date | Next service date |
| ComplianceStatus__c | Picklist | Current, Expired, Pending |
| Certifications__c | Long Text Area | Certifications held |
| LastInspectionDate__c | Date | Last inspection date |
| NextInspectionDate__c | Date | Next inspection due date |
| ComplianceNotes__c | Long Text Area | Compliance notes |
| CurrentValue__c | Currency | Current book value |
| DepreciationAmount__c | Formula(Currency) | `Price - CurrentValue__c` |
| DepreciationRate__c | Formula(Percent) | `(Price - CurrentValue__c) / Price * 100` |
| UsefulLifeMonths__c | Number(3,0) | Expected useful life in months |
| RemainingLifeMonths__c | Formula(Number) | Months remaining |
| Notes__c | Long Text Area | General notes |

### Custom Objects to Create

#### Maintenance_Record__c (Child of Asset)

| Field API Name | Type | Description |
|----------------|------|-------------|
| Asset__c | Master-Detail(Asset) | Parent asset |
| CompletedDate__c | Date | Service completion date |
| MaintenanceType__c | Picklist | Preventive, Corrective, etc |
| Technician__c | Text(100) | Technician name |
| Cost__c | Currency | Service cost |
| Description__c | Long Text Area | Service description |
| NextScheduledDate__c | Date | Next scheduled service |
| Status__c | Picklist | Completed, Pending, Cancelled |

**Relationship Name:** `MaintenanceRecords__r` (Master-Detail from Maintenance_Record__c to Asset)

#### Maintenance_Task__c (Child of Asset)

| Field API Name | Type | Description |
|----------------|------|-------------|
| Asset__c | Lookup(Asset) | Parent asset |
| ScheduledDate__c | Date | Scheduled date |
| TaskType__c | Picklist | Inspection, Service, Repair |
| Description__c | Long Text Area | Task description |
| EstimatedCost__c | Currency | Estimated cost |
| Status__c | Picklist | Pending, Scheduled, Completed |

**Relationship Name:** `UpcomingMaintenanceTasks__r` (Lookup from Maintenance_Task__c to Asset)

---

## Creating the DOCX File

### Step 1: Open Microsoft Word
- Create new document
- **Page Size:** A4 or Letter
- **Orientation:** Portrait

### Step 2: Set Up Styles

**Header Style:**
- Bordered box, full width
- Blue background (#0070C0)
- White text, Bold, 14pt
- Centered alignment

**Section Header Style:**
- Bold, 11pt
- Dark blue color (#002060)
- Horizontal line below (0.5pt, dark gray)
- 6pt space before, 3pt space after

**Field Label Style:**
- Bold, 10pt, Black
- Consistent left margin

**Field Value Style:**
- Regular, 10pt
- Template tags in Courier New, teal color
- Tab stop aligned with labels

### Step 3: Create Header Section
1. Insert table (1 row, 1 column)
2. Remove borders, add shading
3. Add title and generation date
4. Adjust padding (top: 8pt, bottom: 8pt)

### Step 4: Add Content Sections
1. Copy template text from above
2. Apply section header style to each major section
3. Format field labels and values with consistent tabs
4. Preserve all `{{}}` tags exactly

### Step 5: Format Maintenance History

The maintenance history uses a loop that creates multiple entries:

```
{{#each Asset.MaintenanceRecords__r}}
Date: {{CompletedDate__formatted}}
Type: {{MaintenanceType__c}}
...
{{/each}}
```

**Formatting:**
- Each record separated by horizontal line
- Consistent field alignment
- Add spacing between records
- Use bordered box or light shading for each entry

### Step 6: Format Conditional Sections

**Warranty Status:**
- Green background for "✓ UNDER WARRANTY"
- Yellow/orange background for "⚠ WARRANTY EXPIRED"
- Use symbols: ✓ (U+2713), ⚠ (U+26A0)

**Asset Status:**
- Green for "ACTIVE AND INSTALLED"
- Red/orange for other statuses

### Step 7: Add Footer
- Bordered box at bottom
- Include report footer text
- Include Asset ID
- Match header styling

### Step 8: Save
- **File → Save As**
- **File Name:** `Custom_Asset__c.docx`
- **Location:** `samples/templates/`

---

## Template Configuration in Salesforce

### Step 1: Create Schema (if needed)

If starting from scratch:
1. Create custom fields on Asset (see table above)
2. Create Maintenance_Record__c custom object
3. Create Maintenance_Task__c custom object
4. Set up Master-Detail/Lookup relationships
5. Grant FLS via permission sets

**Shortcut:** Use Salesforce CLI to deploy schema:
```bash
# Create fields and objects from metadata
sf project deploy start --source-dir force-app/main/default/objects
```

### Step 2: Upload Template
1. **Files** → **Upload Files** → Select `Custom_Asset__c.docx`
2. Copy **ContentVersionId** from file URL

### Step 3: Create Docgen Template

| Field | Value |
|-------|-------|
| Template Name | Asset Management Report |
| Primary Parent | Asset |
| Data Source | SOQL |
| SOQL | Paste query from above (adjust for your fields) |
| Template Content Version ID | ContentVersionId |

### Step 4: Test with Sample Data

Create test records:
1. Account: "Test Company"
2. Product2: "Test Equipment"
3. Asset: Link to Account and Product
4. Populate custom fields
5. Create 2-3 Maintenance_Record__c records
6. Create 1-2 Maintenance_Task__c records

Generate document and verify all sections populate.

---

## Simplified Version (Fewer Custom Fields)

If you don't want to create all custom fields, use this minimal version:

**Keep these sections:**
- Asset Information (standard fields)
- Account Information (standard relationship)
- Product Information (standard relationship)
- Asset Owner (standard Owner field)

**Remove these sections:**
- Purchase Details (if no custom fields)
- Warranty Information (if no custom fields)
- Location (if no custom fields)
- Technical Specs (if no custom fields)
- Usage Information (if no custom fields)
- Maintenance History (if no child object)
- Compliance (if no custom fields)
- Depreciation (if no custom fields)

**Simplified SOQL:**
```sql
SELECT Id, Name, SerialNumber, Status, PurchaseDate, Price, InstallDate,
       Account.Name, Account.Industry, Account.BillingCity, Account.Phone,
       Product2.Name, Product2.ProductCode, Product2.Family,
       Owner.Name, Owner.Email, Owner.Phone,
       CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name
FROM Asset
WHERE Id = :recordId
```

---

## Troubleshooting

### Issue: Custom fields not found
- **Solution:** Create fields on Asset object or remove from template/SOQL

### Issue: Child relationship not working
- **Solution:** Verify relationship name (`MaintenanceRecords__r`) matches exactly

### Issue: Formula fields showing errors
- **Solution:** Create formula fields or replace with Apex-calculated values

### Issue: Too much data (PDF too large)
- **Solution:** Limit child queries to recent records:
  - `LIMIT 10` in sub-queries
  - Filter by date: `WHERE CompletedDate >= LAST_N_DAYS:90`

### Issue: Formatting broken in PDF
- **Solution:** Simplify template layout
  - Avoid complex tables
  - Use simple borders and shading
  - Test incrementally

---

## Related Files

- **Template Authoring Guide:** `docs/template-authoring.md`
- **Field Path Conventions:** `docs/field-path-conventions.md`
- **Admin Guide:** `docs/ADMIN_GUIDE.md`

---

**Last Updated:** 2025-11-17 (T-11 Implementation)
**Note:** This is an advanced template demonstrating maximum capabilities. Simplify as needed for your use case.
