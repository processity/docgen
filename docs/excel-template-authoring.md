# Excel Template Authoring

Docgen can generate native `.xlsx` workbooks from Salesforce data. The output keeps the template workbook's worksheets, styles, formulas, images, merged cells, column widths, row heights, print settings, and page setup.

## Configure The Template

1. Create a normal Excel workbook and format it as the final output should look.
2. Add scalar placeholders such as `{{Quote.Name}}` to cells.
3. Add one formatted prototype row for each repeating collection.
4. In that row, use `{{TABLE:Quote.LineItems.Name}}`-style placeholders.
5. Add native Excel formulas for calculated columns and totals.
6. Upload the `.xlsx` file to the Docgen Template record.
7. Set **Default Output Format** to `XLSX`, or pass `XLSX` when generating.

## Scalar Values

Use the same dotted field paths used by other Docgen templates:

| Cell | Template value | Result |
| --- | --- | --- |
| B2 | `{{Quote.Name}}` | Quote name |
| B3 | `{{Quote.ExpirationDate}}` | Expiration date |
| B4 | `Total: {{Quote.Total__formatted}}` | Text with a merged value |

When a placeholder occupies the whole cell, numbers and booleans remain native Excel values. Salesforce dates arrive through JSON as strings; use the provider's `__formatted` value when a display-specific date is required. A missing or null value produces a blank cell. Salesforce text beginning with `=` remains text and is not executed as a formula.

### Generation Date

Use `{{Today__formatted}}` to insert the date on which Docgen generated the workbook. Docgen resolves the date using the request timezone and locale, then writes it into the output as a fixed value. It does not change when the workbook is reopened.

`{{GeneratedDate__formatted}}` is an equivalent descriptive alias. Raw ISO date values are also available as `{{Today}}` and `{{GeneratedDate}}`.

## Repeating Table Rows

Put all fields for one collection in the same prototype row:

| A | B | C | D |
| --- | --- | --- | --- |
| `{{TABLE:Quote.LineItems.Name}}` | `{{TABLE:Quote.LineItems.Quantity}}` | `{{TABLE:Quote.LineItems.UnitPrice}}` | `=B10*C10` |

Docgen duplicates the row for every `Quote.LineItems` entry. It preserves row and cell formatting and adjusts relative row references in formulas (`=B10*C10`, `=B11*C11`, and so on).

All `TABLE` placeholders in one row must resolve through the same collection. Nested fields are supported, for example `{{TABLE:Quote.LineItems.Product.Name}}`. A collection of primitive values can use `{{TABLE:Quote.Tags}}`.

If the collection is empty, Docgen leaves one blank formatted prototype row. This keeps surrounding layout and total formulas valid.

Do not merge cells across a repeating row. The generator rejects that template because Excel cannot reliably duplicate overlapping merged ranges. Merged cells elsewhere in the workbook are preserved.

## Totals And Formulas

Author calculations as native Excel formulas. For example, if row 10 is the prototype line and row 11 is the total:

```text
D10 = B10*C10
D11 = SUM(D10:D10)
```

For three line items, Docgen expands the table to rows 10-12 and moves the total to row 13:

```text
D10 = B10*C10
D11 = B11*C11
D12 = B12*C12
D13 = SUM(D10:D12)
```

The workbook is marked for full formula recalculation when opened. Keep formulas in the template; do not store formulas in Salesforce fields.

## Composite Documents

XLSX is supported for a single Docgen Template and for a Composite Document using **Own Template**. The own-template workbook receives the full composite data map and can reference every configured namespace.

XLSX is not supported for **Concatenate Templates** because separate workbooks do not have a deterministic page, sheet, formula, or style concatenation contract. Use one own-template workbook with multiple worksheets instead.

## Preview And Attachments

Salesforce does not provide the inline PDF preview experience for XLSX. Preview-before-save shows the existing unsupported-preview message, after which the user can save and download the workbook.

Additional PDF page attachments are ignored for XLSX output.
