import ExcelJS from 'exceljs';
import { TemplateInvalidFormatError, TemplateMergeError } from '../../src/errors';
import { mergeXlsxTemplate } from '../../src/templates/xlsx';

describe('XLSX template merge', () => {
  it('replaces scalar values and expands a formatted table row with formulas', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Quote Data');
    sheet.getCell('A1').value = 'Offer {{Quote.Name}}';
    sheet.getCell('B1').value = '{{Quote.Discount}}';
    sheet.getCell('A2').value = '{{TABLE:Quote.LineItems.Name}}';
    sheet.getCell('B2').value = '{{TABLE:Quote.LineItems.UnitPrice}}';
    sheet.getCell('C2').value = '{{TABLE:Quote.LineItems.Quantity}}';
    sheet.getCell('D2').value = { formula: 'B2*C2' };
    sheet.getRow(2).height = 24;
    sheet.getCell('A2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF6600' },
    };
    sheet.getCell('B2').numFmt = '$#,##0.00';
    sheet.getCell('D2').numFmt = '$#,##0.00';
    sheet.mergeCells('A3:C3');
    sheet.getCell('A3').value = 'Total';
    sheet.getCell('D3').value = { formula: 'SUM(D2:D2)' };

    const summary = workbook.addWorksheet('Summary');
    summary.getCell('A1').value = { formula: "'Quote Data'!D3" };

    const imageId = workbook.addImage({
      base64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
      extension: 'png',
    });
    sheet.addImage(imageId, 'F1:F1');

    const result = await mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
      Quote: {
        Name: 'Q-1001',
        Discount: 12.5,
        LineItems: [
          { Name: 'Alpha', UnitPrice: 10, Quantity: 2 },
          { Name: 'Beta', UnitPrice: 20, Quantity: 3 },
          { Name: 'Gamma', UnitPrice: 30, Quantity: 4 },
        ],
      },
    });

    const merged = new ExcelJS.Workbook();
    await merged.xlsx.load(result as unknown as Parameters<typeof merged.xlsx.load>[0]);
    const mergedSheet = merged.getWorksheet('Quote Data')!;

    expect(mergedSheet.getCell('A1').value).toBe('Offer Q-1001');
    expect(mergedSheet.getCell('B1').value).toBe(12.5);
    expect(mergedSheet.getCell('A2').value).toBe('Alpha');
    expect(mergedSheet.getCell('A3').value).toBe('Beta');
    expect(mergedSheet.getCell('A4').value).toBe('Gamma');
    expect(mergedSheet.getCell('B3').value).toBe(20);
    expect(mergedSheet.getCell('D2').formula).toBe('B2*C2');
    expect(mergedSheet.getCell('D3').formula).toBe('B3*C3');
    expect(mergedSheet.getCell('D4').formula).toBe('B4*C4');
    expect(mergedSheet.getCell('D5').formula).toBe('SUM(D2:D4)');
    expect(merged.getWorksheet('Summary')!.getCell('A1').formula).toBe("'Quote Data'!D5");
    expect(mergedSheet.getRow(3).height).toBe(24);
    expect(mergedSheet.getCell('A3').fill).toEqual(mergedSheet.getCell('A2').fill);
    expect(mergedSheet.getCell('B3').numFmt).toBe('$#,##0.00');
    expect(mergedSheet.model.merges).toContain('A5:C5');
    expect(mergedSheet.getImages()).toHaveLength(1);
  });

  it('keeps one blank formatted prototype row for an empty collection', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lines');
    sheet.getCell('A2').value = '{{TABLE:Quote.LineItems.Name}}';
    sheet.getCell('A2').font = { bold: true };
    sheet.getCell('B3').value = { formula: 'SUM(B2:B2)' };

    const result = await mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
      Quote: { LineItems: [] },
    });

    const merged = new ExcelJS.Workbook();
    await merged.xlsx.load(result as unknown as Parameters<typeof merged.xlsx.load>[0]);
    const mergedSheet = merged.getWorksheet('Lines')!;
    expect(mergedSheet.getCell('A2').value).toBeNull();
    expect(mergedSheet.getCell('A2').font.bold).toBe(true);
    expect(mergedSheet.getCell('B3').formula).toBe('SUM(B2:B2)');
  });

  it('keeps Salesforce strings beginning with equals as text', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Quote').getCell('A1').value = '{{Quote.Reference}}';

    const result = await mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
      Quote: { Reference: '=HYPERLINK("https://example.invalid","Open")' },
    });

    const merged = new ExcelJS.Workbook();
    await merged.xlsx.load(result as unknown as Parameters<typeof merged.xlsx.load>[0]);
    const cell = merged.getWorksheet('Quote')!.getCell('A1');
    expect(cell.value).toBe('=HYPERLINK("https://example.invalid","Open")');
    expect(cell.formula).toBeUndefined();
  });

  it('writes generation dates as fixed values', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Quote');
    sheet.getCell('A1').value = '{{Today__formatted}}';
    sheet.getCell('A2').value = '{{GeneratedDate__formatted}}';

    const result = await mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
      Today__formatted: '04 Sep 2026',
      GeneratedDate__formatted: '04 Sep 2026',
    });

    const merged = new ExcelJS.Workbook();
    await merged.xlsx.load(result as unknown as Parameters<typeof merged.xlsx.load>[0]);
    const mergedSheet = merged.getWorksheet('Quote')!;

    expect(mergedSheet.getCell('A1').value).toBe('04 Sep 2026');
    expect(mergedSheet.getCell('A1').formula).toBeUndefined();
    expect(mergedSheet.getCell('A2').value).toBe('04 Sep 2026');
    expect(mergedSheet.getCell('A2').formula).toBeUndefined();
  });

  it('supports arrays of primitive values', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tags');
    sheet.getCell('A1').value = '{{TABLE:Quote.Tags}}';

    const result = await mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
      Quote: { Tags: ['One', 'Two'] },
    });

    const merged = new ExcelJS.Workbook();
    await merged.xlsx.load(result as unknown as Parameters<typeof merged.xlsx.load>[0]);
    expect(merged.getWorksheet('Tags')!.getCell('A1').value).toBe('One');
    expect(merged.getWorksheet('Tags')!.getCell('A2').value).toBe('Two');
  });

  it('rejects a repeat row that references different collections', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lines');
    sheet.getCell('A1').value = '{{TABLE:Quote.LineItems.Name}}';
    sheet.getCell('B1').value = '{{TABLE:Quote.Discounts.Name}}';

    await expect(
      mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
        Quote: { LineItems: [{ Name: 'A' }], Discounts: [{ Name: 'B' }] },
      })
    ).rejects.toBeInstanceOf(TemplateMergeError);
  });

  it('rejects merged cells in a repeat row', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lines');
    sheet.mergeCells('A1:B1');
    sheet.getCell('A1').value = '{{TABLE:Quote.LineItems.Name}}';

    await expect(
      mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
        Quote: { LineItems: [{ Name: 'A' }] },
      })
    ).rejects.toThrow('cannot contain merged cells');
  });

  it('rejects data paths that do not contain an array', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lines');
    sheet.getCell('A1').value = '{{TABLE:Quote.Name}}';

    await expect(
      mergeXlsxTemplate(Buffer.from(await workbook.xlsx.writeBuffer()), {
        Quote: { Name: 'Q-1001' },
      })
    ).rejects.toThrow('does not resolve through an array');
  });

  it('rejects invalid XLSX bytes', async () => {
    await expect(mergeXlsxTemplate(Buffer.from('not an xlsx file'), {})).rejects.toBeInstanceOf(
      TemplateInvalidFormatError
    );
  });
});
