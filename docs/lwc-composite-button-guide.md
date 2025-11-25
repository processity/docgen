# LWC Composite Document Generation Button - Configuration Guide

## Overview

The **Composite Document Generation Button** (`compositeDocgenButton`) is a Lightning Web Component that enables interactive composite document generation directly from Salesforce record pages. This component allows users to generate PDF or DOCX documents that combine data from multiple sources (templates) configured in a Composite Document record.

This component is designed for admin configuration via the Lightning App Builder without requiring code.

---

## Component Properties

### Required Properties

| Property | Type | Description | Example |
|----------|------|-------------|---------|
| **Composite Document ID** | String | ID of the `Composite_Document__c` record that defines the composite document configuration | `a0Y1234567890ABC` |
| **Output Format** | Picklist | Document output format: `PDF` or `DOCX` | `PDF` |

### Optional Properties

| Property | Type | Description | Example |
|----------|------|-------------|---------|
| **Record ID Field Name** | String | Variable name for the primary record ID from the page context (e.g., `accountId`, `opportunityId`). Only needed when component is placed on a record page. | `accountId` |
| **Additional Record IDs (JSON)** | String | JSON string containing additional record IDs required by the composite document | `{"contactId":"003xxx","opportunityId":"006xxx"}` |
| **Button Label** | String | Custom text displayed on the button | `Generate Account Report` |
| **Success Message** | String | Custom message shown in success toast notification | `Report generated successfully!` |

---

## Configuration Examples

### Example 1: Single Record ID (Account Page)

**Scenario**: Generate a composite document on an Account page that uses only the Account ID.

**Configuration**:
- **Composite Document ID**: `a0Y1234567890ABC` (Your composite document record)
- **Record ID Field Name**: `accountId`
- **Output Format**: `PDF`
- **Button Label**: `Generate Account Summary`
- **Success Message**: `Account summary generated!`

**Steps**:
1. Navigate to the Account record page in Lightning App Builder
2. Drag the **Composite Document Generation Button** component onto the page
3. Configure properties in the right panel:
   - Set **Composite Document ID** to your composite document's record ID
   - Set **Record ID Field Name** to `accountId`
   - Set **Output Format** to `PDF`
   - Customize **Button Label** and **Success Message** as desired
4. Save and activate the page

**Result**: When a user clicks the button on an Account page, the component will pass `{"accountId": "001xxx"}` to the Apex method.

---

### Example 2: Multiple Record IDs (Opportunity Page with Related Account and Contact)

**Scenario**: Generate a composite document on an Opportunity page that requires the Opportunity ID, related Account ID, and primary Contact ID.

**Configuration**:
- **Composite Document ID**: `a0Y2345678901DEF`
- **Record ID Field Name**: `opportunityId`
- **Additional Record IDs (JSON)**: `{"accountId":"{!Record.AccountId}","contactId":"{!Record.ContactId}"}`
- **Output Format**: `PDF`
- **Button Label**: `Generate Proposal`
- **Success Message**: `Proposal generated successfully!`

**Steps**:
1. Navigate to the Opportunity record page in Lightning App Builder
2. Drag the **Composite Document Generation Button** component onto the page
3. Configure properties:
   - Set **Composite Document ID** to your composite document's record ID
   - Set **Record ID Field Name** to `opportunityId`
   - Set **Additional Record IDs (JSON)** to: `{"accountId":"{!Record.AccountId}","contactId":"{!Record.ContactId}"}`
   - Set **Output Format** to `PDF`
   - Customize labels as desired
4. Save and activate the page

**Result**: When a user clicks the button, the component will pass:
```json
{
  "opportunityId": "006xxx",
  "accountId": "001xxx",
  "contactId": "003xxx"
}
```

**Note**: Use merge field syntax `{!Record.FieldName}` to reference fields from the current record. The Lightning runtime will automatically resolve these at runtime.

---

### Example 3: Static Record IDs (Dashboard or App Page)

**Scenario**: Place a button on a Dashboard or App Page with hardcoded record IDs (e.g., for a global report that always uses the same records).

**Configuration**:
- **Composite Document ID**: `a0Y3456789012GHI`
- **Additional Record IDs (JSON)**: `{"accountId":"001XXXXXXXXXXXXXXX","settingsId":"a00YYYYYYYYYYYYYYY"}`
- **Output Format**: `DOCX`
- **Button Label**: `Generate Monthly Report`

**Steps**:
1. Navigate to the App Page or Dashboard in Lightning App Builder
2. Drag the **Composite Document Generation Button** component onto the page
3. Configure properties:
   - Set **Composite Document ID**
   - Leave **Record ID Field Name** blank (not on a record page)
   - Set **Additional Record IDs (JSON)** with hardcoded IDs
   - Set **Output Format** to `DOCX`
4. Save and activate the page

**Result**: The button will use the hardcoded record IDs for generation.

---

## JSON Format for Additional Record IDs

The **Additional Record IDs (JSON)** property accepts a JSON object where:
- **Keys** are variable names (e.g., `accountId`, `contactId`, `opportunityId`)
- **Values** are Salesforce record IDs (15 or 18 characters)

### Valid JSON Examples

**Simple:**
```json
{"contactId":"003XXXXXXXXXXXXXXX"}
```

**Multiple IDs:**
```json
{"accountId":"001XXXXXXXXXXXXXXX","contactId":"003XXXXXXXXXXXXXXX","caseId":"500YYYYYYYYYYYYYYY"}
```

**With Merge Fields:**
```json
{"accountId":"{!Record.AccountId}","ownerId":"{!Record.OwnerId}"}
```

### Invalid Examples

❌ **Missing quotes around keys:**
```json
{accountId:"001xxx"}
```

❌ **Single quotes instead of double quotes:**
```json
{'accountId':'001xxx'}
```

❌ **Trailing comma:**
```json
{"accountId":"001xxx",}
```

**Tip**: Use an online JSON validator to check your JSON syntax before configuring the component.

---

## Validation and Error Handling

The component performs validation before calling the Apex method:

### Validation Errors

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Composite Document ID is required" | `compositeDocumentId` property is blank | Set the Composite Document ID property |
| "At least one record ID is required" | Neither `recordId` nor `additionalRecordIds` is provided | Set Record ID Field Name (on record pages) or Additional Record IDs |
| "Output Format is required" | `outputFormat` property is blank | Set the Output Format property to PDF or DOCX |

### Generation Errors

If the Apex method fails (e.g., template not found, missing namespace data), an error toast will display with the specific error message from the backend.

**Example Error Toast**:
- **Title**: "Error Generating Document"
- **Message**: "Composite document not found" (from Apex)
- **Variant**: Error (red)

---

## Troubleshooting

### Problem: Button click does nothing

**Possible Causes**:
1. Composite Document ID is invalid or record doesn't exist
2. recordIds validation failed
3. JavaScript error (check browser console)

**Solution**:
- Open browser developer console (F12) and click the button
- Check for validation error toasts
- Verify Composite Document record exists and is active

---

### Problem: "At least one record ID is required" error

**Cause**: Component can't build a recordIds map.

**Solution**:
- If on a record page: Set **Record ID Field Name** property
- If on app/home page: Set **Additional Record IDs (JSON)** property
- Verify JSON syntax is valid (no trailing commas, use double quotes)

---

### Problem: Invalid JSON in Additional Record IDs

**Symptoms**: No validation error, but generation fails or incorrect IDs passed.

**Solution**:
1. Copy the JSON from the property field
2. Paste into a JSON validator (e.g., jsonlint.com)
3. Fix syntax errors (usually missing quotes or trailing commas)
4. Re-paste corrected JSON into the property field

---

### Problem: Merge fields like `{!Record.AccountId}` not resolving

**Cause**: Merge fields are resolved by Lightning App Builder at runtime, not by the component.

**Solution**:
- Ensure you're using the correct syntax: `{!Record.FieldName}`
- Verify the field exists on the current object
- Check the record page is activated and saved
- Try removing and re-adding the component

---

### Problem: Document generation fails with "Missing namespace data"

**Cause**: The Composite Document configuration references a namespace (e.g., "Account", "Terms") but the recordIds map doesn't provide the corresponding record ID.

**Solution**:
1. Review the Composite Document's junction records (`Composite_Document_Template__c`)
2. Identify the namespaces used (e.g., "Account", "Contact", "Terms")
3. Ensure the component configuration provides record IDs for all required namespaces
4. Update **Additional Record IDs (JSON)** to include missing IDs

---

## Step-by-Step: Adding Button to a Record Page

1. **Navigate to Setup** → **Object Manager**
2. Select the object (e.g., **Account**)
3. Click **Lightning Record Pages**
4. Edit an existing page or create a new one
5. In the Lightning App Builder:
   - Locate **Composite Document Generation Button** in the component list
   - Drag it onto the page (typically in the right sidebar or header)
6. **Configure the component** in the right panel:
   - Set **Composite Document ID** (required)
   - Set **Record ID Field Name** if using the page's record (e.g., `accountId`)
   - Set **Additional Record IDs (JSON)** if needed
   - Set **Output Format** (PDF or DOCX)
   - Customize **Button Label** and **Success Message**
7. **Save** the page
8. **Activate** the page (assign to org default or specific profiles/apps)
9. **Test**:
   - Navigate to a record of that object
   - Click the button
   - Verify PDF opens in new tab and success toast appears

---

## Performance Considerations

- **Interactive Generation**: Button triggers synchronous generation. Users may experience 5-15 second wait for complex documents.
- **Loading State**: Component shows a spinner and disables the button during processing to prevent double-clicks.
- **Idempotency**: If the same composite document with the same recordIds is requested within 24 hours, the system may return a cached result (depending on backend configuration).

---

## Security Notes

- **User Permissions**: Users must have:
  - Read access to the Composite_Document__c record
  - Execute permission on the `DocgenController.generateComposite` Apex method
  - Read access to all objects referenced in the composite document's data sources
- **Record ID Visibility**: The component passes record IDs to the backend. Ensure users have access to the records they're generating documents for.
- **File Access**: Generated files are uploaded to Salesforce Files and linked to parent records. Users need appropriate file sharing permissions to access the generated documents.

---

## Related Documentation

- [Composite Template Authoring](composite-template-authoring.md) - Guide for creating composite document templates
- [Composite Batch Examples](composite-batch-examples.md) - Batch generation examples

---

## Support

For technical issues or questions:
1. Check the troubleshooting section above
2. Review the browser console for JavaScript errors
3. Check Salesforce debug logs for Apex errors
4. Contact your Salesforce administrator or development team

---

**Version**: 1.0
**Last Updated**: 2025-11-23
**Component**: `c-composite-docgen-button`
**Apex Controller**: `DocgenController.generateComposite()`
