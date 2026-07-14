# Flow Invocable Action - Generate Document from Flow

## Overview

The **Docgen: Generate Document** invocable action (`DocgenInvocable`) lets admins generate documents from Flow without writing code. It queues document generation for a record using a Docgen Template; the Node.js poller worker picks up the queued request, generates the file, attaches it to the source record, and updates the tracking record - the same asynchronous path used by the progress button LWC and `BatchDocgenEnqueue`.

The action works from:

- **Record-Triggered Flows** (e.g., generate a contract when an Opportunity is marked Closed Won)
- **Scheduled Flows** (e.g., generate monthly account statements)
- **Screen Flows** (e.g., generate a document as part of a guided process)
- **Autolaunched Flows** (invoked from Apex, REST, or other flows)

Generation is asynchronous by design: record-triggered flows run with uncommitted DML, which blocks HTTP callouts, so the action queues a `Generated_Document__c` record instead of calling the API synchronously. The generated file is typically attached to the record within 15-60 seconds (the poller interval).

> Composite documents are not supported by this action. For composite generation from automation, use `BatchDocgenEnqueue` from Apex - see [Composite Batch Examples](composite-batch-examples.md).

---

## Action Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| **Record ID** | String | Yes | ID of the source record (Account, Opportunity, Case, or any other supported object). |
| **Template ID** | String | One of Template ID / Template Name | ID of the `Docgen_Template__c` record. Takes precedence when both are provided. |
| **Template Name** | String | One of Template ID / Template Name | Name of the `Docgen_Template__c` record. Used when Template ID is blank. |
| **Output Format** | String | No | `PDF`, `DOCX`, or `PPTX`. Leave blank to use the template's **Default Output Format** (falls back to `PDF`). |
| **Read-Only Word** | Boolean | No | When `true`, DOCX output is generated as a protected read-only document. Ignored for PDF and PPTX. Defaults to `false`. |

## Action Outputs

| Output | Type | Description |
|--------|------|-------------|
| **Success** | Boolean | `true` when the document was queued for generation. |
| **Generated Document ID** | String | ID of the `Generated_Document__c` record tracking this generation. |
| **Status** | String | Generation status - typically `QUEUED`. Can be `SUCCEEDED` immediately when an identical document already exists (idempotency reuse). |
| **Error Message** | String | Populated when Success is `false` (e.g., template not found, unsupported object). |

The action does not throw on validation failures - it returns `Success = false` with an **Error Message** so one bad record does not fault other flow interviews in the same batch. Use a Decision element on **Success** to branch error handling.

---

## Example: Record-Triggered Flow on Opportunity

**Scenario**: Generate a PDF order form when an Opportunity is marked Closed Won.

1. Create a **Record-Triggered Flow** on **Opportunity**, configured to run when a record is **updated** and `StageName = 'Closed Won'` (only when the record is updated to meet the condition)
2. Add an **Action** element and search for **Docgen: Generate Document**
3. Set the inputs:
   - **Record ID**: `{!$Record.Id}`
   - **Template Name**: `Order Form`
   - **Output Format**: `PDF` (or leave blank for the template default)
4. Optionally store the outputs and add a Decision element on **Success** to create a Case, send a notification, or log the **Error Message** on failure
5. Save and activate the flow

When the flow runs, a `Generated_Document__c` record is created with `Status__c = 'QUEUED'`. The worker generates the PDF and attaches it to the Opportunity, typically within a minute.

## Example: Protected Word Document

To generate a read-only DOCX (e.g., a contract that recipients should not edit):

- **Record ID**: `{!$Record.Id}`
- **Template ID**: `a0X...` (your template's record ID)
- **Output Format**: `DOCX`
- **Read-Only Word**: `{!$GlobalConstant.True}`

---

## Behavior Notes

- **Idempotency**: Duplicate requests (same template, record, data, and options) reuse the existing `Generated_Document__c` row instead of generating twice. A previously `FAILED` or `CANCELED` request with the same inputs is automatically re-queued.
- **Attachment**: When generation succeeds, the file is linked to the source record (and any configured parent records) via `ContentDocumentLink`.
- **Supported objects**: The record's object must be registered in `Supported_Object__mdt` with a lookup field on `Generated_Document__c`. See the [Admin Guide](admin-guide.md) for adding new objects.
- **Bulk usage**: Flow bulkifies invocable calls automatically; each request in the batch is processed independently. Each request consumes SOQL queries to build the data envelope, so for high-volume generation (hundreds+ of records) prefer `BatchDocgenEnqueue`.
- **Permissions**: Running users need the `Docgen_User` permission set (or equivalent access to the Docgen objects and the `DocgenInvocable` class).

## Tracking Generation Status

The action returns before the file is generated. To react to completion, either:

- Build a **Record-Triggered Flow** on `Generated_Document__c` for `Status__c` changing to `SUCCEEDED` or `FAILED`, or
- Query the **Generated Document ID** output later (e.g., from a scheduled path) and check `Status__c` / `OutputFileId__c`

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| `Success = false`, "Template not found" | Template Name misspelled or Template ID invalid | Verify the `Docgen_Template__c` record exists and the name matches exactly |
| `Success = false`, "Object ... is not supported" | Source object not registered | Add the object per the [Admin Guide](admin-guide.md) |
| Document stays `QUEUED` | Poller worker not running | Check worker status - see [Poller](poller.md) and [Runbooks](runbooks.md) |
| Document `FAILED` | Generation error (template merge, data provider, API) | Inspect `Error__c` on the Generated Document record; see [Troubleshooting Index](troubleshooting-index.md) |
