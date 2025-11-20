# Account Summary Report - Template Configuration Guide

**Document Type:** Administrator Walkthrough
**Complexity Level:** Advanced
**Estimated Setup Time:** 45-60 minutes
**Prerequisites:** Basic Salesforce administration knowledge, understanding of SOQL

---

## Table of Contents

1. [Business Requirements](#1-business-requirements)
2. [Data Structure Overview](#2-data-structure-overview)
3. [Sample Test Data](#3-sample-test-data)
4. [SOQL Configuration](#4-soql-configuration)
5. [Template Structure](#5-template-structure)
6. [Section-by-Section Walkthrough](#6-section-by-section-walkthrough)
7. [Advanced Features Explained](#7-advanced-features-explained)
8. [Creating the Docgen Template Record](#8-creating-the-docgen-template-record)
9. [Testing Your Template](#9-testing-your-template)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Business Requirements

### Overview

The Account Summary Report is a comprehensive document that provides a 360-degree view of an Account, suitable for:
- Executive briefings before client meetings
- Quarterly business reviews (QBRs)
- Account handoffs between sales representatives
- Customer success reviews

### What This Template Does

**Displays:**
- ✅ Account basic information with owner details
- ✅ Dynamic account tier classification (Enterprise/Corporate/SMB)
- ✅ VIP status indicator for high-value accounts
- ✅ Complete billing address
- ✅ Financial metrics with calculated revenue per employee
- ✅ All contacts organized by department
- ✅ Opportunity pipeline with stage-by-stage breakdown
- ✅ Weighted pipeline calculations
- ✅ Individual opportunity details with line items
- ✅ Days remaining/overdue calculations for opportunities
- ✅ Support cases with comment history

**Advanced Features Used:**
- JavaScript calculations for dynamic metrics
- Conditional content (VIP badge, case comments)
- Data aggregation (grouping by stage, department)
- Date arithmetic (days until close)
- Nested loops (opportunities → line items, cases → comments)
- Multi-level SOQL subqueries

---

## 2. Data Structure Overview

This template relies on the following Salesforce object relationships:

```
Account (Parent)
├── Owner (User lookup)
├── Contacts (Child relationship)
├── Opportunities (Child relationship)
│   ├── OpportunityLineItems (Grandchild)
│   │   └── Product2 (Lookup)
│   └── Owner (User lookup)
└── Cases (Child relationship)
    ├── Contact (Lookup)
    └── CaseComments (Grandchild)
```

**Key Relationships:**
- **1:N** - Account to Contacts
- **1:N** - Account to Opportunities
- **1:N** - Opportunity to OpportunityLineItems
- **1:N** - Account to Cases
- **1:N** - Case to CaseComments
- **N:1** - OpportunityLineItem to Product2

**Depth:** 3 levels (Account → Opportunity → OpportunityLineItems → Product2)

---

## 3. Sample Test Data

To test this template, you'll need realistic data. Here's the JSON structure the template expects:

### Account Data

```json
{
  "Account": {
    "Id": "001xx000000abcdXXX",
    "Name": "Acme Corporation",
    "Type": "Customer",
    "Industry": "Technology",
    "BillingStreet": "1 Market Street",
    "BillingCity": "San Francisco",
    "BillingState": "CA",
    "BillingPostalCode": "94105",
    "BillingCountry": "United States",
    "Phone": "(415) 555-1234",
    "Website": "https://www.acme.com",
    "AnnualRevenue": 15000000,
    "AnnualRevenue__formatted": "$15,000,000",
    "NumberOfEmployees": 250,
    "NumberOfEmployees__formatted": "250",
    "Description": "Enterprise customer with complex product mix and active support cases",
    "Owner": {
      "Name": "John Sales",
      "Email": "john.sales@yourcompany.com"
    }
  }
}
```

### Contacts Sample

```json
{
  "Contacts": [
    {
      "Id": "003xx000000abcd001",
      "Name": "John Smith",
      "Title": "CEO",
      "Email": "john.smith@acme.com",
      "Phone": "(415) 555-1001",
      "Department": "Executive",
      "CreatedDate": "2024-01-15T09:00:00.000Z"
    },
    {
      "Id": "003xx000000abcd002",
      "Name": "Sarah Johnson",
      "Title": "VP of Engineering",
      "Email": "sarah.johnson@acme.com",
      "Phone": "(415) 555-1002",
      "Department": "Engineering",
      "CreatedDate": "2024-01-16T10:30:00.000Z"
    },
    {
      "Id": "003xx000000abcd003",
      "Name": "Michael Chen",
      "Title": "Product Manager",
      "Email": "michael.chen@acme.com",
      "Phone": "(415) 555-1003",
      "Department": "Product",
      "CreatedDate": "2024-02-01T14:00:00.000Z"
    },
    {
      "Id": "003xx000000abcd004",
      "Name": "Anna Williams",
      "Email": "anna.williams@acme.com",
      "Department": null,
      "CreatedDate": "2024-03-10T11:20:00.000Z"
    }
  ]
}
```

### Opportunities with Line Items

```json
{
  "Opportunities": [
    {
      "Id": "006xx000000abcd001",
      "Name": "FY2025 Enterprise License Renewal",
      "StageName": "Closed Won",
      "Amount": 500000,
      "Amount__formatted": "$500,000",
      "Probability": 100,
      "CloseDate": "2025-06-30",
      "CloseDate__formatted": "June 30, 2025",
      "OpportunityLineItems": [
        {
          "Id": "00kxx000000abcd001",
          "Product2": {
            "Name": "Enterprise Software License",
            "ProductCode": "ESL-001"
          },
          "Quantity": 5,
          "UnitPrice": 50000,
          "UnitPrice__formatted": "$50,000",
          "TotalPrice": 250000,
          "TotalPrice__formatted": "$250,000"
        },
        {
          "Id": "00kxx000000abcd002",
          "Product2": {
            "Name": "Premium Support Package",
            "ProductCode": "SUP-PREM"
          },
          "Quantity": 2,
          "UnitPrice": 15000,
          "UnitPrice__formatted": "$15,000",
          "TotalPrice": 30000,
          "TotalPrice__formatted": "$30,000"
        }
      ]
    },
    {
      "Id": "006xx000000abcd002",
      "Name": "Q4 Professional Services Expansion",
      "StageName": "Closed Won",
      "Amount": 150000,
      "Amount__formatted": "$150,000",
      "Probability": 100,
      "CloseDate": "2025-10-15",
      "CloseDate__formatted": "October 15, 2025",
      "OpportunityLineItems": [
        {
          "Id": "00kxx000000abcd003",
          "Product2": {
            "Name": "Professional Services - Consulting",
            "ProductCode": "PS-CONS"
          },
          "Quantity": 6,
          "UnitPrice": 25000,
          "UnitPrice__formatted": "$25,000",
          "TotalPrice": 150000,
          "TotalPrice__formatted": "$150,000"
        }
      ]
    },
    {
      "Id": "006xx000000abcd003",
      "Name": "New Product Module - Prospecting",
      "StageName": "Prospecting",
      "Amount": 75000,
      "Amount__formatted": "$75,000",
      "Probability": 10,
      "CloseDate": "2026-03-31",
      "CloseDate__formatted": "March 31, 2026",
      "OpportunityLineItems": []
    }
  ]
}
```

### Cases with Comments

```json
{
  "Cases": [
    {
      "Id": "500xx000000abcd001",
      "CaseNumber": "00001234",
      "Subject": "Critical: API Integration Timeout Issues",
      "Status": "Closed",
      "Priority": "High",
      "Origin": "Email",
      "CreatedDate": "2025-09-15T08:30:00.000Z",
      "CreatedDate__formatted": "September 15, 2025",
      "ClosedDate": "2025-09-18T16:45:00.000Z",
      "Contact": {
        "Name": "John Smith",
        "Email": "john.smith@acme.com"
      },
      "CaseComments": [
        {
          "Id": "00axx000000abcd001",
          "CommentBody": "Initial report from customer about intermittent API timeouts during peak hours.",
          "CreatedDate": "2025-09-15T09:00:00.000Z",
          "CreatedDate__formatted": "September 15, 2025 9:00 AM",
          "CreatedBy": {
            "Name": "Support Agent"
          }
        },
        {
          "Id": "00axx000000abcd002",
          "CommentBody": "Engineering team identified and deployed fix. Issue resolved. Following up with customer.",
          "CreatedDate": "2025-09-18T15:30:00.000Z",
          "CreatedDate__formatted": "September 18, 2025 3:30 PM",
          "CreatedBy": {
            "Name": "Engineering Team"
          }
        }
      ]
    },
    {
      "Id": "500xx000000abcd002",
      "CaseNumber": "00001235",
      "Subject": "Feature Request: Custom Dashboard Export",
      "Status": "In Progress",
      "Priority": "Medium",
      "Origin": "Web",
      "CreatedDate": "2025-10-01T14:20:00.000Z",
      "CreatedDate__formatted": "October 1, 2025",
      "Contact": {
        "Name": "Sarah Johnson",
        "Email": "sarah.johnson@acme.com"
      },
      "CaseComments": [
        {
          "Id": "00axx000000abcd003",
          "CommentBody": "Customer requested ability to export custom dashboards to PDF format.",
          "CreatedDate": "2025-10-01T14:25:00.000Z",
          "CreatedDate__formatted": "October 1, 2025 2:25 PM",
          "CreatedBy": {
            "Name": "Product Team"
          }
        }
      ]
    },
    {
      "Id": "500xx000000abcd003",
      "CaseNumber": "00001236",
      "Subject": "Question: User Permissions Configuration",
      "Status": "New",
      "Priority": "Low",
      "Origin": "Phone",
      "CreatedDate": "2025-10-15T10:00:00.000Z",
      "CreatedDate__formatted": "October 15, 2025",
      "Contact": {
        "Name": "Michael Chen",
        "Email": "michael.chen@acme.com"
      },
      "CaseComments": []
    }
  ]
}
```

**Note:** The `__formatted` suffix fields are prepared by Apex to ensure consistent currency, date, and number formatting based on user locale.

---

## 4. SOQL Configuration

### Complete SOQL Query

This is the SOQL you'll enter in the `Docgen_Template__c` record's `SOQL__c` field:

```sql
SELECT
  Id, Name, Type, Industry,
  BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry,
  Phone, Website, AnnualRevenue, NumberOfEmployees, Description,
  Owner.Name, Owner.Email,

  (SELECT Id, Name, Title, Email, Phone, Department, CreatedDate
   FROM Contacts
   ORDER BY CreatedDate),

  (SELECT Id, Name, StageName, Amount, Probability, CloseDate,
          Type, NextStep, Description,
          (SELECT Id, Product2.Name, Product2.ProductCode,
                  Quantity, UnitPrice, TotalPrice, Description
           FROM OpportunityLineItems
           ORDER BY CreatedDate)
   FROM Opportunities
   ORDER BY CloseDate DESC),

  (SELECT Id, CaseNumber, Subject, Status, Priority, Origin,
          CreatedDate, ClosedDate, Description,
          Contact.Name, Contact.Email,
          (SELECT Id, CommentBody, CreatedDate, CreatedBy.Name
           FROM CaseComments
           ORDER BY CreatedDate)
   FROM Cases
   ORDER BY CreatedDate DESC)

FROM Account
WHERE Id = :recordId
```

### SOQL Breakdown

#### Main Query (Account Level)
```sql
SELECT
  Id, Name, Type, Industry,
  BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry,
  Phone, Website, AnnualRevenue, NumberOfEmployees, Description,
  Owner.Name, Owner.Email,
```

**What it does:**
- Retrieves core Account fields
- Traverses lookup to Owner (User) to get Name and Email
- Uses dot notation for relationship fields: `Owner.Name`

**Why these fields:**
- Basic info for header section
- Financial data for tier calculation
- Owner details for contact information

---

#### Subquery 1: Contacts
```sql
(SELECT Id, Name, Title, Email, Phone, Department, CreatedDate
 FROM Contacts
 ORDER BY CreatedDate)
```

**Relationship Name:** `Contacts` (plural, child relationship)
**Parent → Child:** Account → Contact
**Max Records:** 200 (Salesforce subquery limit)

**What it does:**
- Gets all Contacts related to the Account
- Orders by creation date (oldest first)
- Used for contact list and department grouping

**Fields explained:**
- `Name` - Full name (FirstName + LastName combined by Salesforce)
- `Title` - Job title for context
- `Email, Phone` - Contact methods
- `Department` - Used for grouping (can be null)
- `CreatedDate` - For sorting

---

#### Subquery 2: Opportunities (with nested LineItems)
```sql
(SELECT Id, Name, StageName, Amount, Probability, CloseDate,
        Type, NextStep, Description,
        (SELECT Id, Product2.Name, Product2.ProductCode,
                Quantity, UnitPrice, TotalPrice, Description
         FROM OpportunityLineItems
         ORDER BY CreatedDate)
 FROM Opportunities
 ORDER BY CloseDate DESC)
```

**Relationship Name:** `Opportunities` (plural)
**Parent → Child:** Account → Opportunity
**Depth:** 2 levels (Opportunity has child OpportunityLineItems)

**What it does:**
- Gets all Opportunities for the Account
- For each Opportunity, gets all related LineItems
- Orders Opportunities by CloseDate (newest first)

**Nested Subquery: OpportunityLineItems**
- **Relationship Name:** `OpportunityLineItems` (plural)
- **Parent → Child:** Opportunity → OpportunityLineItem
- **Traverses lookup:** `Product2.Name` (LineItem → Product)

**Why nested?**
- Shows product details for each opportunity
- Enables line-item-level reporting
- Supports product revenue analysis

---

#### Subquery 3: Cases (with nested Comments)
```sql
(SELECT Id, CaseNumber, Subject, Status, Priority, Origin,
        CreatedDate, ClosedDate, Description,
        Contact.Name, Contact.Email,
        (SELECT Id, CommentBody, CreatedDate, CreatedBy.Name
         FROM CaseComments
         ORDER BY CreatedDate)
 FROM Cases
 ORDER BY CreatedDate DESC)
```

**Relationship Name:** `Cases` (plural)
**Parent → Child:** Account → Case
**Depth:** 2 levels (Case has child CaseComments)

**What it does:**
- Gets all Cases for the Account
- For each Case, gets all Comments
- Traverses to Contact for customer name
- Traverses to CreatedBy (User) for commenter name

**Nested Subquery: CaseComments**
- **Relationship Name:** `CaseComments` (plural)
- **Parent → Child:** Case → CaseComment
- **Special:** `CreatedBy.Name` traverses to User object

---

### SOQL Best Practices Used

✅ **Use of WHERE Id = :recordId**
- The `:recordId` bind variable is automatically provided by the system
- When generating from a button, it's the current record ID
- When batch processing, it's each record in the batch

✅ **Ordered subqueries**
- `ORDER BY CreatedDate` - Chronological order
- `ORDER BY CloseDate DESC` - Most recent opportunities first

✅ **Field selection**
- Only queried fields needed for the template
- Included lookup relationships (Owner.Name, Product2.Name)

✅ **Subquery limits respected**
- Each subquery can return max 200 records
- Template handles empty arrays gracefully

---

## 5. Template Structure

The template is organized into logical sections:

```
1. ACCOUNT INFORMATION
   ├── Basic fields (Name, Type, Industry)
   ├── Dynamic tier classification (JavaScript)
   └── VIP badge (conditional)

2. BILLING ADDRESS
   └── Multi-line address format

3. FINANCIAL INFORMATION
   ├── Formatted values
   └── Calculated revenue per employee (JavaScript)

4. KEY CONTACTS
   ├── Contact list (FOR loop)
   └── Department grouping (EXEC + FOR)

5. SALES OPPORTUNITIES
   ├── Total count (JavaScript)
   ├── Pipeline by stage (EXEC + aggregation)
   ├── Weighted pipeline (JavaScript reduce)
   └── Individual opportunities (nested FOR loops)
       └── Line items (nested)

6. SUPPORT CASES
   └── Cases with comments (nested FOR + conditional)
```

---

## 6. Section-by-Section Walkthrough

### Section 1: Account Information

#### Template Code:
```
ACCOUNT INFORMATION

Account Name: {{Account.Name}}
Type: {{Account.Type}}
Industry: {{Account.Industry}}
Owner: {{Account.Owner.Name}}

Account Tier: {{=
  Account.AnnualRevenue > 10000000 ? 'Enterprise (Tier 1)' :
  Account.AnnualRevenue > 1000000 ? 'Corporate (Tier 2)' :
  'SMB (Tier 3)'
}}

{{IF Account.AnnualRevenue > 5000000}}
🌟 VIP ACCOUNT - Premium Support Eligible
{{END-IF}}
```

#### How It Works:

**Simple Field References:**
- `{{Account.Name}}` - Inserts the Account name
- `{{Account.Type}}` - Inserts account type (e.g., "Customer")
- `{{Account.Owner.Name}}` - Traverses lookup to get owner's name

**JavaScript Expression (Account Tier):**
```javascript
{{=
  Account.AnnualRevenue > 10000000 ? 'Enterprise (Tier 1)' :
  Account.AnnualRevenue > 1000000 ? 'Corporate (Tier 2)' :
  'SMB (Tier 3)'
}}
```

**What this does:**
- Uses **chained ternary operators** for multi-condition logic
- Evaluates AnnualRevenue against thresholds
- Returns appropriate tier label
- The `{{=` syntax means "evaluate and insert result"

**Logic flow:**
1. If revenue > $10M → "Enterprise (Tier 1)"
2. Else if revenue > $1M → "Corporate (Tier 2)"
3. Else → "SMB (Tier 3)"

**Conditional Content (VIP Badge):**
```
{{IF Account.AnnualRevenue > 5000000}}
🌟 VIP ACCOUNT - Premium Support Eligible
{{END-IF}}
```

- Only shows VIP badge if revenue exceeds $5M
- Entire section (including emoji) is conditional
- If condition is false, nothing is rendered

---

### Section 2: Billing Address

#### Template Code:
```
BILLING ADDRESS

{{Account.BillingStreet}}
{{Account.BillingCity}}, {{Account.BillingState}} {{Account.BillingPostalCode}}
{{Account.BillingCountry}}
```

#### How It Works:

**Multi-line address formatting:**
- Each field reference is on its own line in the template
- Creates natural line breaks in the output
- Missing fields render as empty (handled gracefully)

**Output example:**
```
1 Market Street
San Francisco, CA 94105
United States
```

**Pro tip:** If address fields can be null, wrap in IF block:
```
{{IF Account.BillingStreet}}
{{Account.BillingStreet}}
{{Account.BillingCity}}, {{Account.BillingState}} {{Account.BillingPostalCode}}
{{Account.BillingCountry}}
{{END-IF}}
```

---

### Section 3: Financial Information

#### Template Code:
```
FINANCIAL INFORMATION
Annual Revenue: {{Account.AnnualRevenue__formatted}}
Employees: {{Account.NumberOfEmployees}}
Phone: {{Account.Phone}}

Revenue per Employee: {{=
  Account.NumberOfEmployees > 0
    ? (Account.AnnualRevenue / Account.NumberOfEmployees).toLocaleString('en-GB', {
        style: 'currency',
        currency: 'GBP',
        maximumFractionDigits: 0
      })
    : 'N/A'
}}
```

#### How It Works:

**Formatted Fields (from Apex):**
- `{{Account.AnnualRevenue__formatted}}` - Pre-formatted by Apex
- Shows as "$15,000,000" with proper locale formatting
- **Best practice:** Let Apex handle formatting when possible

**JavaScript Calculation:**
```javascript
{{=
  Account.NumberOfEmployees > 0
    ? (Account.AnnualRevenue / Account.NumberOfEmployees).toLocaleString('en-GB', {
        style: 'currency',
        currency: 'GBP',
        maximumFractionDigits: 0
      })
    : 'N/A'
}}
```

**Breakdown:**
1. **Guard clause:** `Account.NumberOfEmployees > 0`
   - Prevents division by zero
   - Returns "N/A" if no employees

2. **Calculation:** `AnnualRevenue / NumberOfEmployees`
   - Simple division

3. **Formatting:** `.toLocaleString('en-GB', {...})`
   - `en-GB` - British English locale
   - `style: 'currency'` - Format as currency
   - `currency: 'GBP'` - British Pounds
   - `maximumFractionDigits: 0` - No decimals (rounds to nearest pound)

**Result:** "£60,000" per employee

**When to use JavaScript formatting:**
- ✅ Dynamic calculations (like this example)
- ✅ Aggregations not pre-computed by Apex
- ❌ Not for simple field display (use `__formatted` instead)

---

### Section 4: Key Contacts

#### Template Code:
```
KEY CONTACTS

{{FOR contact IN Account.Contacts}}
{{$contact.Name}}
{{$contact.Email}}
{{$contact.Phone}}
{{$contact.Title}}

{{END-FOR contact}}

Contacts by Department:

{{EXEC
  const contacts = Account.Contacts || [];
  const byDept = {};
  contacts.forEach(contact => {
    const dept = contact.Department || 'Unassigned';
    byDept[dept] = (byDept[dept] || 0) + 1;
  });
  deptList = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
}}

{{FOR dept IN deptList}}
{{$dept[0]}}
{{$dept[1]}} contact{{= $dept[1] > 1 ? 's' : '' }}

{{END-FOR dept}}
```

#### How It Works:

**Part 1: Contact List**
```
{{FOR contact IN Account.Contacts}}
{{$contact.Name}}
...
{{END-FOR contact}}
```

- **FOR loop** iterates over the Contacts array
- `$contact` prefix accesses loop variable properties
- Each contact renders as a block (name, email, phone, title)
- Creates one paragraph per contact

**Part 2: Department Grouping (Advanced)**

**Step 1: EXEC Block (Data Preparation)**
```javascript
{{EXEC
  const contacts = Account.Contacts || [];
  const byDept = {};
  contacts.forEach(contact => {
    const dept = contact.Department || 'Unassigned';
    byDept[dept] = (byDept[dept] || 0) + 1;
  });
  deptList = Object.entries(byDept).sort((a, b) => b[1] - a[1]);
}}
```

**What EXEC does:**
- Executes JavaScript without inserting anything
- Defines variables for later use

**Line-by-line explanation:**

1. `const contacts = Account.Contacts || [];`
   - Safe array access (handles null)

2. `const byDept = {};`
   - Create empty object to store counts

3. `contacts.forEach(contact => { ... })`
   - Loop through each contact

4. `const dept = contact.Department || 'Unassigned';`
   - Get department, default to "Unassigned" if null

5. `byDept[dept] = (byDept[dept] || 0) + 1;`
   - Increment count for this department
   - `|| 0` handles first occurrence (undefined)

6. `deptList = Object.entries(byDept).sort((a, b) => b[1] - a[1]);`
   - Convert object to array: `[['Executive', 1], ['Engineering', 2]]`
   - Sort by count descending (most contacts first)
   - Store in `deptList` for the FOR loop

**Step 2: Display Results**
```
{{FOR dept IN deptList}}
{{$dept[0]}}
{{$dept[1]}} contact{{= $dept[1] > 1 ? 's' : '' }}
{{END-FOR dept}}
```

- `$dept[0]` - Department name (e.g., "Engineering")
- `$dept[1]` - Count (e.g., 2)
- `{{= $dept[1] > 1 ? 's' : '' }}` - Pluralization (contact vs contacts)

**Output example:**
```
Engineering
2 contacts

Executive
1 contact

Unassigned
1 contact
```

**Why EXEC + FOR instead of single JavaScript block?**
- ❌ `\n` doesn't create line breaks in Word
- ✅ FOR loop creates proper paragraph breaks
- ✅ Cleaner output formatting

---

### Section 5: Sales Opportunities

#### Template Code (Part 1: Summary Statistics):
```
SALES OPPORTUNITIES

Total Opportunities: {{= (Account.Opportunities || []).length }}

Pipeline Summary by Stage
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

Weighted Pipeline (by Probability): {{=
(Account.Opportunities || [])
  .reduce((sum, o) => sum + ((o.Amount || 0) * (o.Probability || 0) / 100), 0)
  .toLocaleString('en-GB', {style: 'currency', currency: 'GBP'})
}}
```

#### How It Works:

**Total Count (Simple):**
```javascript
{{= (Account.Opportunities || []).length }}
```
- Safe array access with `|| []`
- `.length` returns count
- Example output: "5"

**Pipeline by Stage (Complex Aggregation):**

The EXEC block performs multi-metric aggregation:

```javascript
const byStage = {};
opps.forEach(opp => {
  const stage = opp.StageName || 'Unknown';
  if (!byStage[stage]) {
    byStage[stage] = { count: 0, total: 0 };  // Initialize
  }
  byStage[stage].count++;                      // Increment count
  byStage[stage].total += opp.Amount || 0;     // Add to total
});
```

**Data structure built:**
```javascript
{
  "Closed Won": { count: 2, total: 650000 },
  "Prospecting": { count: 1, total: 75000 },
  "Negotiation/Review": { count: 1, total: 45000 }
}
```

**Transform for display:**
```javascript
stageList = Object.entries(byStage)
  .sort((a, b) => b[1].total - a[1].total)  // Sort by amount
  .map(([stage, data]) => ({                // Convert to objects
    stage: stage,
    count: data.count,
    total: data.total
  }));
```

**Display with FOR loop:**
```
Closed Won: 2 opps | £650,000
Prospecting: 1 opp | £75,000
Negotiation/Review: 1 opp | £45,000
```

**Weighted Pipeline (Advanced Calculation):**
```javascript
{{=
(Account.Opportunities || [])
  .reduce((sum, o) => sum + ((o.Amount || 0) * (o.Probability || 0) / 100), 0)
  .toLocaleString('en-GB', {style: 'currency', currency: 'GBP'})
}}
```

**How .reduce() works:**
1. Starts with `sum = 0`
2. For each opportunity:
   - `(o.Amount || 0) * (o.Probability || 0) / 100`
   - Example: $100,000 × 75% = $75,000
   - Adds to sum
3. Returns final total

**Example calculation:**
- Closed Won: $650,000 × 100% = $650,000
- Prospecting: $75,000 × 10% = $7,500
- Negotiation: $45,000 × 75% = $33,750
- **Weighted Total: $691,250**

**Why weighted pipeline matters:**
- More accurate forecast than simple sum
- Accounts for deal likelihood
- Used in sales forecasting

---

#### Template Code (Part 2: Individual Opportunities):
```
{{FOR opp IN Account.Opportunities}}
{{$opp.Name}}
Stage: {{$opp.StageName}} | Amount: {{$opp.Amount__formatted}}
Close Date: {{$opp.CloseDate__formatted}} | Probability: {{$opp.Probability}}%
{{=
  const closeDate = new Date($opp.CloseDate);
  const today = new Date();
  const diffDays = Math.ceil((closeDate - today) / (1000 * 60 * 60 * 24));
  diffDays > 0 ? `(${diffDays} days remaining)` :
  diffDays === 0 ? '(Closes TODAY)' :
  `(${Math.abs(diffDays)} days overdue)'`
}}

Line Items:
{{FOR item IN $opp.OpportunityLineItems}}
• {{$item.Product2.Name}}: {{$item.Quantity}} × {{$item.UnitPrice__formatted}} = {{$item.TotalPrice__formatted}}
{{END-FOR item}}
{{END-FOR opp}}
```

#### How It Works:

**Outer Loop (Opportunities):**
```
{{FOR opp IN Account.Opportunities}}
```
- Iterates through each opportunity
- Access with `$opp` prefix

**Date Arithmetic (Days Calculation):**
```javascript
{{=
  const closeDate = new Date($opp.CloseDate);
  const today = new Date();
  const diffDays = Math.ceil((closeDate - today) / (1000 * 60 * 60 * 24));
  diffDays > 0 ? `(${diffDays} days remaining)` :
  diffDays === 0 ? '(Closes TODAY)' :
  `(${Math.abs(diffDays)} days overdue)`
}}
```

**Step-by-step:**

1. **Parse dates:**
   ```javascript
   const closeDate = new Date($opp.CloseDate);  // "2025-06-30"
   const today = new Date();                     // Current date
   ```

2. **Calculate difference in milliseconds:**
   ```javascript
   closeDate - today  // Milliseconds between dates
   ```

3. **Convert to days:**
   ```javascript
   / (1000 * 60 * 60 * 24)
   ```
   - Divide by 1000 → seconds
   - Divide by 60 → minutes
   - Divide by 60 → hours
   - Divide by 24 → days

4. **Round up:**
   ```javascript
   Math.ceil(...)  // 3.2 days → 4 days
   ```

5. **Conditional output:**
   - Positive → "X days remaining"
   - Zero → "Closes TODAY"
   - Negative → "X days overdue" (use Math.abs for positive number)

**Example outputs:**
- `(45 days remaining)` - Future close date
- `(Closes TODAY)` - Closes today
- `(5 days overdue)` - Past close date

---

**Inner Loop (Line Items - Nested):**
```
{{FOR item IN $opp.OpportunityLineItems}}
• {{$item.Product2.Name}}: {{$item.Quantity}} × {{$item.UnitPrice__formatted}} = {{$item.TotalPrice__formatted}}
{{END-FOR item}}
```

**Nested loop structure:**
- Outer: `FOR opp` (opportunities)
  - Inner: `FOR item IN $opp.OpportunityLineItems` (line items)
  - Note: Access parent loop variable with `$opp`

**Traversing lookup:**
- `$item.Product2.Name` - Traverses from LineItem → Product2
- Product2 is a lookup field on OpportunityLineItem

**Output example:**
```
FY2025 Enterprise License Renewal
Stage: Closed Won | Amount: $500,000
Close Date: June 30, 2025 | Probability: 100%
(45 days remaining)

Line Items:
• Enterprise Software License: 5 × $50,000 = $250,000
• Premium Support Package: 2 × $15,000 = $30,000
```

**Empty line items handling:**
- If `OpportunityLineItems` is empty, FOR loop renders nothing
- No error, no blank lines
- Graceful handling of missing data

---

### Section 6: Support Cases

#### Template Code:
```
SUPPORT CASES

{{FOR c IN Account.Cases}}
CASE #{{$c.CaseNumber}}: {{$c.Subject}}
Status: {{$c.Status}} | Priority: {{$c.Priority}}

{{IF $c.CaseComments}}
Comments:
{{FOR comment IN $c.CaseComments}}
[{{$comment.CreatedDate__formatted}}] {{$comment.CreatedBy.Name}}:
{{$comment.CommentBody}}
{{END-FOR comment}}
{{END-IF}}

{{END-FOR c}}
```

#### How It Works:

**Outer Loop (Cases):**
```
{{FOR c IN Account.Cases}}
CASE #{{$c.CaseNumber}}: {{$c.Subject}}
```
- Iterates through cases
- `$c` prefix to access case properties
- `CaseNumber` is auto-generated by Salesforce

**Conditional Comments:**
```
{{IF $c.CaseComments}}
Comments:
...
{{END-IF}}
```

**Why this check?**
- `CaseComments` can be empty array `[]`
- Empty array is truthy in JavaScript
- But we check existence to avoid showing "Comments:" with no comments

**Better alternative:**
```
{{IF $c.CaseComments.length}}
```
- Checks if array has items
- `0` is falsy, so empty array won't show section

**Inner Loop (Comments - Nested):**
```
{{FOR comment IN $c.CaseComments}}
[{{$comment.CreatedDate__formatted}}] {{$comment.CreatedBy.Name}}:
{{$comment.CommentBody}}
{{END-FOR comment}}
```

**Nested structure:**
- Outer: Cases
  - Inner: CaseComments (child of Case)
  - Access parent with `$c`

**Lookup traversal:**
- `$comment.CreatedBy.Name` - Traverses from CaseComment → User
- `CreatedBy` is a standard lookup on CaseComment

**Output example:**
```
CASE #00001234: Critical: API Integration Timeout Issues
Status: Closed | Priority: High

Comments:
[September 15, 2025 9:00 AM] Support Agent:
Initial report from customer about intermittent API timeouts during peak hours.

[September 18, 2025 3:30 PM] Engineering Team:
Engineering team identified and deployed fix. Issue resolved.
```

**Edge case (no comments):**
```
CASE #00001236: Question: User Permissions Configuration
Status: New | Priority: Low

```
- Comments section not shown (IF condition false)
- Clean output

---

## 7. Advanced Features Explained

### Feature 1: EXEC Blocks

**What:** Execute JavaScript without output

**Syntax:**
```javascript
{{EXEC
  // Your JavaScript code here
  variableName = someCalculation();
}}
```

**When to use:**
- Preparing data for FOR loops
- Complex calculations
- Defining reusable variables

**Example from template:**
```javascript
{{EXEC
  const contacts = Account.Contacts || [];
  deptList = Object.entries(byDept).sort(...);
}}
```

**Key points:**
- Variables defined here are available in later blocks
- Use `const` for local scope, omit `const` for global
- Must end with `}}` (exactly two braces)

---

### Feature 2: Nested FOR Loops

**What:** Loop within a loop

**Pattern:**
```
{{FOR parent IN parentArray}}
  {{FOR child IN $parent.childArray}}
    {{$child.field}}
  {{END-FOR child}}
{{END-FOR parent}}
```

**Access patterns:**
- Current loop variable: `$child`
- Parent loop variable: `$parent`
- Root data: `Account.field`

**Example from template:**
```
{{FOR opp IN Account.Opportunities}}
  {{FOR item IN $opp.OpportunityLineItems}}
    {{$item.Product2.Name}}
  {{END-FOR item}}
{{END-FOR opp}}
```

**Maximum depth:** 3-4 levels recommended

---

### Feature 3: JavaScript Array Methods

**filter()** - Find items matching criteria
```javascript
Account.Opportunities.filter(o => o.StageName === 'Closed Won')
```

**map()** - Transform array
```javascript
Account.Contacts.map(c => c.Email)
```

**reduce()** - Aggregate to single value
```javascript
Account.Opportunities.reduce((sum, o) => sum + o.Amount, 0)
```

**sort()** - Order array
```javascript
list.sort((a, b) => b[1] - a[1])  // Descending
```

**Chaining methods:**
```javascript
Account.Opportunities
  .filter(o => o.Amount > 100000)
  .map(o => o.Name)
  .join(', ')
```

---

### Feature 4: Safe Property Access

**Problem:** Null reference errors

**Solution 1: Optional chaining**
```javascript
{{= Account.Owner?.Name || 'Unassigned' }}
```

**Solution 2: OR operator**
```javascript
{{= (Account.Contacts || []).length }}
```

**Solution 3: Ternary guard**
```javascript
{{= Account.NumberOfEmployees > 0 ? calculation : 'N/A' }}
```

**Always use:**
- `|| []` for arrays
- `|| 0` for numbers in calculations
- `|| 'default'` for strings
- `?.` for nested lookups

---

### Feature 5: Conditional Content

**Pattern 1: IF/END-IF**
```
{{IF condition}}
  Content to show
{{END-IF}}
```

**Pattern 2: Inline ternary**
```javascript
{{= condition ? 'Yes' : 'No' }}
```

**Pattern 3: JavaScript expression in IF**
```
{{IF Account.AnnualRevenue > 5000000 && Account.IsActive}}
  VIP Customer
{{END-IF}}
```

**Supported operators:**
- `>`, `<`, `>=`, `<=`, `===`, `!==`
- `&&` (AND), `||` (OR)
- `!` (NOT)

---

### Feature 6: Date Arithmetic

**Common pattern:**
```javascript
const date1 = new Date(dateString);
const date2 = new Date();
const diffMillis = date2 - date1;
const diffDays = diffMillis / (1000 * 60 * 60 * 24);
```

**Conversion factors:**
- 1000 = milliseconds to seconds
- 60 = seconds to minutes
- 60 = minutes to hours
- 24 = hours to days

**Rounding:**
- `Math.floor()` - Round down
- `Math.ceil()` - Round up
- `Math.round()` - Round to nearest

---

### Feature 7: Number Formatting

**Currency:**
```javascript
value.toLocaleString('en-GB', {
  style: 'currency',
  currency: 'GBP'
})
```

**Percentage:**
```javascript
(0.755).toLocaleString('en-GB', {style: 'percent'})
// Output: "75.5%"
```

**Thousands separator:**
```javascript
number.toLocaleString('en-GB')
// 1234567 → "1,234,567"
```

**Locales:**
- `en-GB` - British English (£)
- `en-US` - American English ($)
- `de-DE` - German (€)

---

## 8. Creating the Docgen Template Record

### Step 1: Upload Template File

1. Create your DOCX file with the template content
2. Save as `account-summary-template.docx`
3. In Salesforce, navigate to **Files**
4. Click **Upload Files**
5. Select your DOCX file
6. After upload, open the file details
7. Copy the **Content Version ID** (starts with `068`)

### Step 2: Create Docgen_Template__c Record

Navigate to **Docgen Template** tab and click **New**

**Field Values:**

| Field | Value |
|-------|-------|
| **Name** | `Account Summary Report` |
| **DataSource__c** | `SOQL` |
| **SOQL__c** | Paste the complete SOQL from Section 4 |
| **TemplateContentVersionId__c** | Your Content Version ID (068...) |
| **StoreMergedDocx__c** | ☐ Unchecked |
| **ReturnDocxToBrowser__c** | ☐ Unchecked |
| **PrimaryParent__c** | `Account` |

### Step 3: Verify SOQL

**Important checks:**
1. ✅ No extra quotes around `:recordId`
2. ✅ Proper subquery syntax (parentheses)
3. ✅ Relationship names are plural (Contacts, not Contact)
4. ✅ No typos in field names

**Test the SOQL:**
1. Go to Developer Console
2. Open **Query Editor**
3. Replace `:recordId` with actual Account ID
4. Run query
5. Verify it returns data

Example:
```sql
SELECT Id, Name, (SELECT Id, Name FROM Contacts)
FROM Account
WHERE Id = '001xx000000abcdXXX'
```

---

## 9. Testing Your Template

### Test Scenario 1: Basic Generation

**Prerequisites:**
- Account with at least 1 Contact, 1 Opportunity, 1 Case

**Steps:**
1. Navigate to an Account record
2. Click the **Generate PDF** button (custom button)
3. Select your template
4. Wait for generation
5. Download and review PDF

**What to check:**
- ✅ Account info displays correctly
- ✅ Tier classification shows appropriate value
- ✅ VIP badge appears (if revenue > $5M)
- ✅ Contacts list all contacts
- ✅ Department grouping works

### Test Scenario 2: Edge Cases

**Create test data with:**
- ❌ Contact with no Department (should show "Unassigned")
- ❌ Opportunity with no Line Items (should skip line items section)
- ❌ Case with no Comments (should not show "Comments:" header)
- ❌ Account with 0 employees (revenue per employee should show "N/A")

**Expected behavior:**
- No errors
- Graceful handling of missing data
- Clean output

### Test Scenario 3: Complex Data

**Create test data:**
- ✅ 10+ Contacts across 5 departments
- ✅ 5+ Opportunities in different stages
- ✅ Multiple line items per opportunity
- ✅ 5+ Cases with multiple comments

**What to verify:**
- Pipeline summary shows all stages
- Weighted pipeline calculated correctly
- Date calculations are accurate
- All nested data renders

### Test Scenario 4: Data Accuracy

**Manual verification:**

1. **Tier Classification:**
   - Revenue $12M should show "Enterprise (Tier 1)" ✓
   - Revenue $5M should show "Corporate (Tier 2)" ✓
   - Revenue $500K should show "SMB (Tier 3)" ✓

2. **Revenue per Employee:**
   - $15M revenue ÷ 250 employees = $60,000 ✓

3. **Weighted Pipeline:**
   - Add up: (Amount × Probability%) for all open opps
   - Compare to PDF output

4. **Days Calculation:**
   - Check "days remaining" against actual close date
   - Verify past dates show "days overdue"

---

## 10. Troubleshooting

### Issue: "No data returned" or blank sections

**Possible causes:**
1. SOQL doesn't return related records
2. Field API names incorrect
3. Relationship names incorrect

**Solution:**
```sql
-- Test in Developer Console
SELECT Id,
       (SELECT Id FROM Contacts),
       (SELECT Id FROM Opportunities)
FROM Account
WHERE Id = 'YOUR_ACCOUNT_ID'
```

Check that subqueries return records.

---

### Issue: JavaScript not calculating

**Symptoms:**
- Blank where calculation should be
- Template shows `{{=` literally

**Possible causes:**
1. Syntax error in JavaScript
2. Extra `}` or missing `}`
3. Variable not defined

**Solution:**
1. Test JavaScript in browser console first
2. Check brace matching
3. Add error handling:
   ```javascript
   {{=
     try {
       // your calculation
     } catch(e) {
       'Error: ' + e.message
     }
   }}
   ```

---

### Issue: FOR loop not rendering

**Symptoms:**
- Section completely missing
- No items shown

**Checklist:**
1. ✅ Array exists in data? (check SOQL)
2. ✅ Relationship name correct? (plural form)
3. ✅ `FOR` and `END-FOR` paired correctly?
4. ✅ Using `$` prefix for loop variable?

**Debug:**
```
Array length: {{= (Account.Contacts || []).length }}
```

If shows 0, problem is data. If shows number but no items, problem is template syntax.

---

### Issue: Dates showing wrong values

**Symptoms:**
- "NaN days" or incorrect calculations
- Dates off by one day

**Possible causes:**
1. Date format incompatible with `new Date()`
2. Timezone issues
3. Formatted date used instead of raw value

**Solution:**
Use raw date field (not `__formatted`):
```javascript
// WRONG
const closeDate = new Date($opp.CloseDate__formatted);

// RIGHT
const closeDate = new Date($opp.CloseDate);
```

Salesforce dates are ISO format: `2025-06-30`

---

### Issue: Nested loops not working

**Symptoms:**
- Second level loop shows nothing
- Error or blank

**Common mistakes:**
```javascript
// WRONG - missing $opp prefix
{{FOR item IN OpportunityLineItems}}

// RIGHT - use parent loop variable
{{FOR item IN $opp.OpportunityLineItems}}
```

**Structure:**
```
{{FOR parent IN Account.ParentArray}}
  {{FOR child IN $parent.ChildArray}}
    {{$child.field}}
  {{END-FOR child}}
{{END-FOR parent}}
```

---

### Issue: Currency showing wrong locale

**Symptom:**
- Shows $ instead of £
- Wrong thousand separator

**Solution:**
Update locale in JavaScript:
```javascript
value.toLocaleString('en-GB', {  // British
  style: 'currency',
  currency: 'GBP'  // Pounds
})

// Or US:
value.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD'
})
```

---

### Issue: Template merge fails silently

**Symptoms:**
- Status shows FAILED
- No PDF generated
- Error__c field has cryptic message

**Common causes:**
1. Extra `}` in EXEC block
2. Missing `;` in JavaScript
3. Line break inside function call
4. Invalid field reference

**Debugging approach:**
1. Start with minimal template (just `{{Account.Name}}`)
2. Add sections one at a time
3. Test after each addition
4. Identify which section causes failure

**Check Node logs:**
```bash
# If you have access to backend
docker logs <container> | grep ERROR
```

---

## Summary Checklist

### Before You Start
- ☐ Understand SOQL subqueries
- ☐ Have test Account with related data
- ☐ Can access Docgen Template object

### SOQL Setup
- ☐ Includes all needed fields
- ☐ Subqueries for Contacts, Opportunities, Cases
- ☐ Nested subqueries for LineItems, Comments
- ☐ Lookup traversals (Owner.Name, Product2.Name)
- ☐ Tested in Developer Console

### Template Creation
- ☐ Created DOCX with template tags
- ☐ Used FOR loops for arrays
- ☐ Used EXEC for data preparation
- ☐ Added JavaScript calculations
- ☐ Included conditional sections
- ☐ Handles edge cases (null, empty arrays)

### Docgen Template Record
- ☐ Uploaded DOCX to Files
- ☐ Created Docgen_Template__c record
- ☐ Set correct ContentVersionId
- ☐ Pasted SOQL into SOQL__c field
- ☐ Set PrimaryParent to Account

### Testing
- ☐ Test with simple data
- ☐ Test with complex data
- ☐ Test edge cases
- ☐ Verify calculations
- ☐ Check formatting
- ☐ Confirm PDF looks good

### Production
- ☐ Add to Account page layout
- ☐ Document for users
- ☐ Train admin team
- ☐ Monitor for errors

---

## Additional Resources

- **Template Authoring Guide:** `/docs/template-authoring.md`
- **JavaScript Examples:** `/docs/JavaScript_Template_Examples_Explained.md`
- **Development Context:** `/development-context.md`
- **E2E Test:** `/e2e/tests/account-summary-complex.spec.ts`

---

**Document Version:** 1.0
**Last Updated:** 2025-11-20
**Author:** Docgen Team

For support, contact your Salesforce administrator or refer to the Docgen documentation.
