# LWC Docgen Document Selector - Configuration Guide

## Overview

The **Docgen Document Selector** (`docgenDocumentSelector`) is a Lightning Web Component that provides the full interactive document generation experience for a record:

1. **Source selection** - the user chooses between a single template and a composite document.
2. **Document lookup** - a debounced search over `Docgen_Template__c` (by name) or active `Composite_Document__c` records (SOSL over description and composite number), scoped to the record's object. Blank searches show recently viewed records first.
3. **Generation** - the component embeds `docgenProgressButton` (template) or `compositeDocgenButton` (composite), so additional PDF attachment selection, progress tracking, inline PDF preview, and Save/Cancel actions all work out of the box. The action label is format-based for both sources: `Generate PDF`, `Generate DOCX`, `Generate PPTX`, or `Generate XLSX`.

The component is object-agnostic: it works for any object that has templates or composite documents configured (`PrimaryParent__c`).

---

## Component Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| **recordId** | String | (auto) | Record the document is generated for. Provided automatically by the Lightning runtime on record pages. |
| **objectApiName** | String | (auto) | API name of the object whose templates/composite documents are offered. Provided automatically on record pages; must be set explicitly when embedded by another LWC. |
| **objectLabel** | String | derived | Display label used in lookup labels and empty-state messages (e.g. `Quote` renders "Quote template", "Search Quote templates..."). Defaults to a label derived from `objectApiName` (`SBQQ__Quote__c` → `Quote`). |
| **recordIdField** | String | `recordId` | Variable name for the record ID in composite generation. Must match the record ID variable expected by the composite document's templates (e.g. `quoteId`, `accountId`). |
| **outputFormat** | String | `PDF` | Output format passed to the generator (`PDF`, `DOCX`, `PPTX`, `XLSX`). |
| **previewBeforeSave** | Boolean | `false` | Generate in preview mode: the user reviews the document and must Save or Cancel before it is linked to the record. |
| **docgenType** | String | — | Optional preset: `template` or `composite`. See [Preset selection lock](#preset-selection-lock). |
| **docgenName** | String | — | Optional preset document name. See [Preset selection lock](#preset-selection-lock). |
| **hideFilePicker** | Boolean | `false` | Hide the additional PDF file picker rendered by the embedded generator. See [Controlling the additional PDF picker](#controlling-the-additional-pdf-picker). |
| **additionalPdfContentVersionIds** | String[] / JSON | `[]` | Optional preset ContentVersion IDs of PDF files merged after the generated document (PDF output only). See [Controlling the additional PDF picker](#controlling-the-additional-pdf-picker). |
| **startGenerationHandler** | Function | — | Optional parent-supplied queued-start delegate, forwarded to either embedded generator. Programmatic use only; see [Delegating start](#delegating-start-to-a-shared-apex-service). |

---

## Usage

### On a Lightning record page (App Builder)

Drag **Docgen Document Selector** onto any supported object's record page. `recordId` and `objectApiName` are injected automatically; optionally set **Object Label**, **Record ID Field**, **Output Format**, and **Preview Before Save**.

### Embedded in another LWC (e.g. a quick action)

```html
<c-docgen-document-selector
  record-id={recordId}
  object-api-name="SBQQ__Quote__c"
  object-label="Quote"
  record-id-field="quoteId"
  output-format="PDF"
  preview-before-save="true"
  docgen-type={docgenType}
  docgen-name={docgenName}
></c-docgen-document-selector>
```

When embedding, always pass `object-api-name` explicitly - the Lightning runtime only injects it into components placed directly on record pages.

---

## Preset selection lock

`docgenType` and `docgenName` are optional. When **both** are provided:

- The component resolves the name against the same search Apex used by the lookups, scoped to `objectApiName`.
- Matching is exact and case-insensitive against the template **Name**, or for composites against the **Composite Document Number** (`CD-xxxxx`) or the exact **Description**.
- On a match, the source and document are pre-selected and locked: the source toggle, search/clear controls, and interactive composite help text are hidden. The user sees the selected document and its format-based Generate action.
- If either property is missing, `docgenType` is not `template`/`composite`, no match is found, or the lookup fails, the component silently falls back to the normal editable selection UI.

---

## Controlling the additional PDF picker

For PDF output, the embedded generator shows a file picker so the user can attach related PDF files to the generated document. Two properties control this:

- **hideFilePicker** - hides the picker entirely. Use when the parent decides the attachments (or wants none).
- **additionalPdfContentVersionIds** - presets the attachment ContentVersion IDs programmatically (array, or JSON array string).

When passing preset attachment IDs, also set `hide-file-picker="true"`: the visible picker does not display programmatically preset IDs, and any user interaction with it replaces them.

```html
<c-docgen-document-selector
  record-id={recordId}
  object-api-name="SBQQ__Quote__c"
  docgen-type="composite"
  docgen-name="CD-00042"
  hide-file-picker="true"
  additional-pdf-content-version-ids={contentVersionIds}
></c-docgen-document-selector>
```

Combined with the preset selection lock, this yields a fully predetermined generation: the user can only click Generate.

---

## Delegating Start to a Shared Apex Service

`docgenDocumentSelector`, `docgenProgressButton`, and `compositeDocgenButton` accept an optional `startGenerationHandler` function. A host application can route both its UI and external API through one Apex business service while reusing the package's progress, preview, Save and Cancel controls.

```html
<c-docgen-document-selector
  record-id={recordId}
  object-api-name={objectApiName}
  preview-before-save="true"
  start-generation-handler={startWithPolicy}
></c-docgen-document-selector>
```

The parent supplies `startWithPolicy` as a function returning a Promise of a `DocgenAsyncController.StartResult`-compatible object. If its Apex adapter returns JSON text, parse that text before returning it to the component.

- For a template, the callback receives `templateId`, `templateName`, `recordId`, `outputFormat`, `readOnlyWord`, `additionalPdfContentVersionIds`, and `previewMode` when enabled.
- For a composite, it receives `compositeDocumentId`, `recordIds` as a JSON string, `outputFormat`, `previewMode`, `readOnlyWord`, and `additionalPdfContentVersionIds`.
- Honor the requested preview mode. Return the actual `generatedDocumentId`, `status`, `isTerminal`, and the remaining start-result fields from Apex.
- A supplied handler replaces the package's default start call; rejection produces the normal error event without falling back to another generation path. Composite delegation uses the queued path even when preview is disabled.
- Polling and preview actions remain in the package. Listen for `docgensave` to invoke any host-owned post-save business action.

Omitting the handler preserves standalone behavior. Business rules and provider routing belong in the host service; the reusable components do not contain application-specific document mappings. See [Salesforce Async Integration](api.md#salesforce-async-integration) for operation-keyed Apex calls.

---

## Apex dependencies

The lookups call `CompositeDocumentController`:

- `searchActiveTemplates(objectApiName, searchTerm, limitSize)` - `Docgen_Template__c` filtered by `PrimaryParent__c`; LIKE search on Name; recently viewed fallback for blank terms.
- `searchActiveCompositeDocuments(objectApiName, searchTerm, limitSize)` - active `Composite_Document__c` filtered by `PrimaryParent__c`; SOSL over all fields; recently viewed fallback for blank terms.

Both return `CompositeDocumentSearchResult` DTOs (`id`, `name`, `description`, `label`, `subLabel`) and cap `limitSize` at 20.

The Quote-scoped `searchActiveQuoteTemplates` / `searchActiveQuoteCompositeDocuments` methods are retained as thin delegates for backward compatibility with existing subscriber code; new code should call the object-parameterized methods.

---

## Events

The embedded generator components emit bubbling, composed events a parent can listen to: `docgenstart`, `docgenprogress`, `docgenpreview`, `docgensave`, `docgencancel`, `docgensuccess`, `docgenerror`.

---

## Example: subscriber quick action

A subscriber org wraps this component in a screen quick action that runs org-specific validation first, then renders the selector next to a legacy fallback option. The wrapper stays thin: validation, permission checks, and modal chrome belong to the subscriber; everything about selecting and generating documents comes from the package.
