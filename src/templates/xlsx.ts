import ExcelJS from 'exceljs';
import type { Cell, CellFormulaValue, CellRichTextValue, CellValue, Row, Worksheet } from 'exceljs';
import { TemplateInvalidFormatError, TemplateMergeError } from '../errors';
import { createLogger } from '../utils/logger';
import { timeStage } from '../obs';

const logger = createLogger('templates:xlsx');
const TABLE_PLACEHOLDER =
  /\{\{\s*TABLE\s*:\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/gi;
const SCALAR_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;
const WHOLE_TABLE_PLACEHOLDER =
  /^\s*\{\{\s*TABLE\s*:\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}\s*$/i;
const WHOLE_SCALAR_PLACEHOLDER =
  /^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}\s*$/;
const CELL_REFERENCE =
  /(?<![A-Za-z0-9_.])(?:(?<sheet>'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(?<columnAbsolute>\$?)(?<column>[A-Z]{1,3})(?<rowAbsolute>\$?)(?<row>[1-9]\d*)(?::(?<endColumnAbsolute>\$?)(?<endColumn>[A-Z]{1,3})(?<endRowAbsolute>\$?)(?<endRow>[1-9]\d*))?(?![A-Za-z0-9_])(?!\s*\()/gi;
const MAX_EXCEL_COLUMN = 16384; // XFD

interface TableBinding {
  arrayPath: string;
  itemPath: string;
  items: unknown[];
}

interface FormulaSnapshot {
  worksheetName: string;
  row: number;
  column: number;
  formula: string;
}

/**
 * Merge an XLSX workbook while preserving its native workbook structure.
 *
 * Scalar cells use {{Account.Name}}. A prototype row containing
 * {{TABLE:Quote.LineItems.Name}} is repeated once per collection item.
 */
export async function mergeXlsxTemplate(
  template: Buffer,
  data: Record<string, unknown>
): Promise<Buffer> {
  return timeStage('merge', () => mergeXlsxTemplateInternal(template, data));
}

async function mergeXlsxTemplateInternal(
  template: Buffer,
  data: Record<string, unknown>
): Promise<Buffer> {
  logger.debug(
    { templateSize: template.length, dataKeys: Object.keys(data) },
    'Starting XLSX merge'
  );

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(template as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (error) {
    if (error instanceof Error) {
      throw new TemplateInvalidFormatError(`Unable to read XLSX template: ${error.message}`);
    }
    throw new TemplateInvalidFormatError('Unable to read XLSX template');
  }

  try {
    if (workbook.worksheets.length === 0) {
      throw new TemplateInvalidFormatError('XLSX template contains no worksheets');
    }

    for (const worksheet of workbook.worksheets) {
      const tableRows = findTableRows(worksheet).sort((left, right) => right - left);
      for (const rowNumber of tableRows) {
        expandTableRow(workbook, worksheet, rowNumber, data);
      }
    }

    replaceScalarPlaceholders(workbook, data);
    workbook.calcProperties.fullCalcOnLoad = true;
    (
      workbook.calcProperties as typeof workbook.calcProperties & { forceFullCalc?: boolean }
    ).forceFullCalc = true;

    const result = Buffer.from(await workbook.xlsx.writeBuffer());
    logger.info(
      {
        templateSize: template.length,
        resultSize: result.length,
        worksheetCount: workbook.worksheets.length,
      },
      'XLSX merge complete'
    );
    return result;
  } catch (error) {
    if (error instanceof TemplateInvalidFormatError || error instanceof TemplateMergeError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new TemplateMergeError(`XLSX merge failed: ${error.message}`);
    }
    throw new TemplateMergeError('Unknown XLSX merge failure');
  }
}

function findTableRows(worksheet: Worksheet): number[] {
  const tableRows: number[] = [];
  worksheet.eachRow((row, rowNumber) => {
    let hasTablePlaceholder = false;
    row.eachCell((cell) => {
      if (typeof cell.value === 'string' && containsTablePlaceholder(cell.value)) {
        hasTablePlaceholder = true;
      }
    });
    if (hasTablePlaceholder) {
      tableRows.push(rowNumber);
    }
  });
  return tableRows;
}

function expandTableRow(
  workbook: ExcelJS.Workbook,
  worksheet: Worksheet,
  rowNumber: number,
  data: Record<string, unknown>
): void {
  const row = worksheet.getRow(rowNumber);
  const tablePaths = collectTablePaths(row);
  const bindings = tablePaths.map((path) => resolveTableBinding(data, path));
  const arrayPaths = new Set(bindings.map((binding) => binding.arrayPath));

  if (arrayPaths.size !== 1) {
    throw new TemplateMergeError(
      `XLSX table row ${worksheet.name}!${rowNumber} references multiple collections: ${[...arrayPaths].join(', ')}`
    );
  }
  if (rowIntersectsMerge(worksheet, rowNumber)) {
    throw new TemplateMergeError(
      `XLSX table row ${worksheet.name}!${rowNumber} cannot contain merged cells`
    );
  }

  const items = bindings[0].items;
  const outputRowCount = Math.max(items.length, 1);
  const insertedRowCount = outputRowCount - 1;
  if (insertedRowCount > 0) {
    const formulas = captureFormulas(workbook);
    worksheet.duplicateRow(rowNumber, insertedRowCount, true);
    restoreFormulasAfterInsertion(workbook, formulas, worksheet.name, rowNumber, insertedRowCount);
  }

  for (let offset = 0; offset < outputRowCount; offset += 1) {
    const item = items[offset];
    const outputRow = worksheet.getRow(rowNumber + offset);
    outputRow.eachCell((cell) => {
      if (typeof cell.value === 'string' && containsTablePlaceholder(cell.value)) {
        cell.value = replaceTableValue(cell.value, data, item, bindings[0].arrayPath);
      }
    });
  }
}

function collectTablePaths(row: Row): string[] {
  const paths: string[] = [];
  row.eachCell((cell) => {
    if (typeof cell.value !== 'string') {
      return;
    }
    for (const match of cell.value.matchAll(new RegExp(TABLE_PLACEHOLDER.source, 'gi'))) {
      paths.push(match[1]);
    }
  });
  return paths;
}

function resolveTableBinding(data: Record<string, unknown>, path: string): TableBinding {
  const parts = path.split('.');
  for (let index = parts.length; index > 0; index -= 1) {
    const arrayPath = parts.slice(0, index).join('.');
    const value = resolvePath(data, arrayPath);
    if (Array.isArray(value)) {
      return {
        arrayPath,
        itemPath: parts.slice(index).join('.'),
        items: value,
      };
    }
  }

  throw new TemplateMergeError(`XLSX table placeholder ${path} does not resolve through an array`);
}

function replaceTableValue(
  templateValue: string,
  data: Record<string, unknown>,
  item: unknown,
  expectedArrayPath: string
): CellValue {
  const wholeMatch = templateValue.match(WHOLE_TABLE_PLACEHOLDER);
  if (wholeMatch) {
    const binding = resolveTableBinding(data, wholeMatch[1]);
    assertSameArrayPath(binding.arrayPath, expectedArrayPath);
    return toCellValue(item === undefined ? undefined : resolvePath(item, binding.itemPath));
  }

  return templateValue.replace(
    new RegExp(TABLE_PLACEHOLDER.source, 'gi'),
    (_match, path: string) => {
      const binding = resolveTableBinding(data, path);
      assertSameArrayPath(binding.arrayPath, expectedArrayPath);
      const value = item === undefined ? undefined : resolvePath(item, binding.itemPath);
      return value == null ? '' : String(value);
    }
  );
}

function assertSameArrayPath(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new TemplateMergeError(
      `XLSX table row references multiple collections: ${expected}, ${actual}`
    );
  }
}

function replaceScalarPlaceholders(
  workbook: ExcelJS.Workbook,
  data: Record<string, unknown>
): void {
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => replaceScalarCellValue(cell, data));
    });
  });
}

function replaceScalarCellValue(cell: Cell, data: Record<string, unknown>): void {
  if (typeof cell.value === 'string') {
    const wholeMatch = cell.value.match(WHOLE_SCALAR_PLACEHOLDER);
    if (wholeMatch) {
      cell.value = toCellValue(resolvePath(data, wholeMatch[1]));
      return;
    }
    cell.value = cell.value.replace(
      new RegExp(SCALAR_PLACEHOLDER.source, 'g'),
      (_match, path: string) => {
        const value = resolvePath(data, path);
        return value == null ? '' : String(value);
      }
    );
    return;
  }

  if (isRichTextValue(cell.value)) {
    cell.value = {
      richText: cell.value.richText.map((run) => ({
        ...run,
        text: run.text.replace(
          new RegExp(SCALAR_PLACEHOLDER.source, 'g'),
          (_match, path: string) => {
            const value = resolvePath(data, path);
            return value == null ? '' : String(value);
          }
        ),
      })),
    };
  }
}

function isRichTextValue(value: CellValue): value is CellRichTextValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'richText' in value &&
    Array.isArray(value.richText)
  );
}

function toCellValue(value: unknown): CellValue {
  if (value == null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function resolvePath(root: unknown, path: string): unknown {
  if (!path) {
    return root;
  }
  let current = root;
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function containsTablePlaceholder(value: string): boolean {
  return new RegExp(TABLE_PLACEHOLDER.source, 'i').test(value);
}

function rowIntersectsMerge(worksheet: Worksheet, rowNumber: number): boolean {
  return worksheet.model.merges.some((range) => {
    const match = range.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/i);
    return Boolean(match && rowNumber >= Number(match[1]) && rowNumber <= Number(match[2]));
  });
}

function captureFormulas(workbook: ExcelJS.Workbook): FormulaSnapshot[] {
  const formulas: FormulaSnapshot[] = [];
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, column) => {
        if (cell.formula) {
          formulas.push({
            worksheetName: worksheet.name,
            row: rowNumber,
            column,
            formula: cell.formula,
          });
        }
      });
    });
  });
  return formulas;
}

function restoreFormulasAfterInsertion(
  workbook: ExcelJS.Workbook,
  formulas: FormulaSnapshot[],
  targetWorksheetName: string,
  anchorRow: number,
  insertedRowCount: number
): void {
  for (const snapshot of formulas) {
    const worksheet = workbook.getWorksheet(snapshot.worksheetName);
    if (!worksheet) {
      continue;
    }

    const destinationRow =
      snapshot.worksheetName === targetWorksheetName && snapshot.row > anchorRow
        ? snapshot.row + insertedRowCount
        : snapshot.row;
    const adjustedFormula = adjustFormulaForInsertion(
      snapshot.formula,
      snapshot.worksheetName,
      targetWorksheetName,
      anchorRow,
      insertedRowCount
    );
    setFormula(worksheet.getCell(destinationRow, snapshot.column), adjustedFormula);

    if (snapshot.worksheetName === targetWorksheetName && snapshot.row === anchorRow) {
      for (let offset = 1; offset <= insertedRowCount; offset += 1) {
        setFormula(
          worksheet.getCell(anchorRow + offset, snapshot.column),
          translateRelativeFormulaRows(adjustedFormula, offset)
        );
      }
    }
  }
}

function setFormula(cell: Cell, formula: string): void {
  const value: CellFormulaValue = { formula };
  cell.value = value;
}

function adjustFormulaForInsertion(
  formula: string,
  formulaWorksheetName: string,
  targetWorksheetName: string,
  anchorRow: number,
  insertedRowCount: number
): string {
  return transformFormulaReferences(formula, (reference) => {
    const referenceWorksheet = reference.sheetName || formulaWorksheetName;
    if (referenceWorksheet.toLowerCase() !== targetWorksheetName.toLowerCase()) {
      return reference.original;
    }

    let startRow = reference.row;
    let endRow = reference.endRow;
    if (endRow == null) {
      if (startRow > anchorRow) {
        startRow += insertedRowCount;
      }
    } else if (startRow > anchorRow) {
      startRow += insertedRowCount;
      endRow += insertedRowCount;
    } else if (endRow >= anchorRow) {
      endRow += insertedRowCount;
    }

    return buildReference(reference, startRow, endRow);
  });
}

function translateRelativeFormulaRows(formula: string, rowOffset: number): string {
  return transformFormulaReferences(formula, (reference) => {
    const startRow = reference.rowAbsolute ? reference.row : reference.row + rowOffset;
    const endRow =
      reference.endRow == null
        ? undefined
        : reference.endRowAbsolute
          ? reference.endRow
          : reference.endRow + rowOffset;
    return buildReference(reference, startRow, endRow);
  });
}

interface ParsedReference {
  original: string;
  sheetToken?: string;
  sheetName?: string;
  columnAbsolute: string;
  column: string;
  rowAbsolute: string;
  row: number;
  endColumnAbsolute?: string;
  endColumn?: string;
  endRowAbsolute?: string;
  endRow?: number;
}

function transformFormulaReferences(
  formula: string,
  transform: (reference: ParsedReference) => string
): string {
  return mapFormulaOutsideStrings(formula, (segment) =>
    segment.replace(CELL_REFERENCE, (original, ...args: unknown[]) => {
      const groups = args.at(-1) as Record<string, string | undefined>;
      if (columnNumber(groups.column!) > MAX_EXCEL_COLUMN) {
        return original;
      }
      if (groups.endColumn && columnNumber(groups.endColumn) > MAX_EXCEL_COLUMN) {
        return original;
      }

      const reference: ParsedReference = {
        original,
        sheetToken: groups.sheet,
        sheetName: groups.sheet ? normalizeSheetName(groups.sheet) : undefined,
        columnAbsolute: groups.columnAbsolute || '',
        column: groups.column!,
        rowAbsolute: groups.rowAbsolute || '',
        row: Number(groups.row),
        endColumnAbsolute: groups.endColumnAbsolute,
        endColumn: groups.endColumn,
        endRowAbsolute: groups.endRowAbsolute,
        endRow: groups.endRow ? Number(groups.endRow) : undefined,
      };
      return transform(reference);
    })
  );
}

function mapFormulaOutsideStrings(formula: string, transform: (segment: string) => string): string {
  let result = '';
  let segmentStart = 0;
  let inString = false;

  for (let index = 0; index < formula.length; index += 1) {
    if (formula[index] !== '"') {
      continue;
    }
    if (inString && formula[index + 1] === '"') {
      index += 1;
      continue;
    }

    if (!inString) {
      result += transform(formula.slice(segmentStart, index));
      segmentStart = index;
      inString = true;
    } else {
      result += formula.slice(segmentStart, index + 1);
      segmentStart = index + 1;
      inString = false;
    }
  }

  const tail = formula.slice(segmentStart);
  result += inString ? tail : transform(tail);
  return result;
}

function buildReference(reference: ParsedReference, row: number, endRow?: number): string {
  const sheetPrefix = reference.sheetToken ? `${reference.sheetToken}!` : '';
  const start = `${reference.columnAbsolute}${reference.column}${reference.rowAbsolute}${row}`;
  if (!reference.endColumn || endRow == null) {
    return `${sheetPrefix}${start}`;
  }
  const end = `${reference.endColumnAbsolute || ''}${reference.endColumn}${reference.endRowAbsolute || ''}${endRow}`;
  return `${sheetPrefix}${start}:${end}`;
}

function normalizeSheetName(sheetToken: string): string {
  if (sheetToken.startsWith("'") && sheetToken.endsWith("'")) {
    return sheetToken.slice(1, -1).replace(/''/g, "'");
  }
  return sheetToken;
}

function columnNumber(column: string): number {
  let value = 0;
  for (const character of column.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}
