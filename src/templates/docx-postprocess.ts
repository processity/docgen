import JSZip from 'jszip';
import type { MergeOptions } from '../types';
import { applyRichTextToWordprocessingXml } from './rich-text';

const DOCUMENT_XML = 'word/document.xml';
const DOCUMENT_RELS = 'word/_rels/document.xml.rels';
const CONTENT_TYPES = '[Content_Types].xml';
const RELS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEADER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const SETTINGS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const SETTINGS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const WORDPROCESSING_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const EDITABLE_MARKER_PATTERN =
  /\{\{\s*(TEXTBOX|DATE|DATEBOX|DATEPICKER)\s*:\s*([^{}]+?)\s*\}\}/gi;
const CONTROL_TOKEN_PATTERN = /__DOCGEN_CONTROL_(\d+)(?:_(START|END))?__/g;
const DEFAULT_EXPRESSION_PATTERN = /^(?:=|INS\b)\s*(.*)$/i;
const PARAGRAPH_PATTERN = /<w:p(?:\s[^>]*?)?>[\s\S]*?<\/w:p>/g;
const RUN_PATTERN = /<w:r(?:\s[^>]*?)?>[\s\S]*?<\/w:r>/g;
const TEXT_NODE_PATTERN = /<w:t(?:\s[^>]*?)?>([\s\S]*?)<\/w:t>/g;
const RUN_PROPERTIES_PATTERN = /^\s*(<w:rPr\b(?:[^>]*\/>|[\s\S]*?<\/w:rPr>))/;

export interface DocxPostProcessContext {
  controls: ControlMarker[];
  rowMarkers: RowMarker[];
  canPostProcess: boolean;
}

interface ControlMarker {
  name: string;
  type: 'text' | 'date';
}

interface RowMarker {
  token: string;
  remove: boolean;
}

type ExtendedMergeOptions = MergeOptions & {
  readOnly?: boolean;
  readOnlyWord?: boolean;
  protect?: boolean;
  protection?: boolean | { enabled?: boolean; edit?: string };
  watermarkText?: string | null;
  watermarkStyle?: string | null;
};

interface WatermarkStyle {
  font: string;
  width: number;
  height: number;
  rotation: number;
  color: string;
}

const DEFAULT_WATERMARK_STYLE: WatermarkStyle = {
  font: 'Courier',
  width: 350,
  height: 50,
  rotation: -45,
  color: '#808080',
};

export async function preprocessDocxTemplate(
  template: Buffer,
  data: Record<string, unknown>
): Promise<{ template: Buffer; context: DocxPostProcessContext }> {
  const context: DocxPostProcessContext = {
    controls: [],
    rowMarkers: [],
    canPostProcess: false,
  };

  const zip = await tryLoadDocx(template);
  if (!zip) {
    return { template, context };
  }

  let changed = false;
  const xmlPaths = Object.keys(zip.files).filter(isDocxTemplatesXmlPath);

  for (const path of xmlPaths) {
    const file = zip.file(path);
    if (!file) {
      continue;
    }

    let xml = await file.async('string');
    const normalizedXml = normalizeWordprocessingNamespacePrefixes(xml);
    changed = changed || normalizedXml !== xml;
    xml = normalizedXml;

    if (path === DOCUMENT_XML) {
      const rowResult = addRowSuppressionMarkers(xml, data, context.rowMarkers);
      xml = rowResult.xml;
      changed = changed || rowResult.changed;
    }

    if (isTemplateXmlPath(path)) {
      const controlResult = replaceEditableMarkers(xml, context.controls);
      xml = controlResult.xml;
      changed = changed || controlResult.changed;
    }

    zip.file(path, xml);
  }

  if (!changed) {
    context.canPostProcess = true;
    return { template, context };
  }

  context.canPostProcess = true;
  return {
    template: await zip.generateAsync({ type: 'nodebuffer' }),
    context,
  };
}

export async function postProcessMergedDocx(
  merged: Buffer,
  context: DocxPostProcessContext,
  options: MergeOptions
): Promise<Buffer> {
  if (!context.canPostProcess) {
    return merged;
  }

  const zip = await tryLoadDocx(merged);
  if (!zip) {
    return merged;
  }

  await postProcessXmlParts(zip, context);

  const extendedOptions = options as ExtendedMergeOptions;
  if (shouldProtectDocument(extendedOptions)) {
    await addDocumentProtection(zip, getProtectionEditMode(extendedOptions));
  }

  const watermarkText = normalizeOptionText(extendedOptions.watermarkText);
  if (watermarkText) {
    await addWatermark(zip, watermarkText, extendedOptions.watermarkStyle);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function applyWatermarkToDocx(
  docx: Buffer,
  watermarkText?: string | null,
  watermarkStyle?: string | null
): Promise<Buffer> {
  const text = normalizeOptionText(watermarkText);
  if (!text) {
    return docx;
  }

  const zip = await tryLoadDocx(docx);
  if (!zip) {
    return docx;
  }

  await addWatermark(zip, text, watermarkStyle);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function isTemplateXmlPath(path: string): boolean {
  return /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(path);
}

function isDocxTemplatesXmlPath(path: string): boolean {
  return /^word\/[^/]+\.xml$/.test(path);
}

function normalizeWordprocessingNamespacePrefixes(xml: string): string {
  const namespacePattern = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)=(["'])${escapeRegExp(WORDPROCESSING_NAMESPACE)}\\2`,
    'g'
  );
  const prefixes = [...xml.matchAll(namespacePattern)]
    .map((match) => match[1])
    .filter((prefix) => prefix !== 'w');
  let nextXml = xml;

  for (const prefix of prefixes) {
    const escapedPrefix = escapeRegExp(prefix);
    const aliasDeclaration = new RegExp(
      `\\s+xmlns:${escapedPrefix}=(["'])${escapeRegExp(WORDPROCESSING_NAMESPACE)}\\1`
    );
    const canonicalDeclaration = new RegExp(
      `xmlns:w=(["'])${escapeRegExp(WORDPROCESSING_NAMESPACE)}\\1`
    );

    if (canonicalDeclaration.test(nextXml)) {
      nextXml = nextXml.replace(aliasDeclaration, '');
    } else {
      nextXml = nextXml.replace(
        new RegExp(`xmlns:${escapedPrefix}=`),
        'xmlns:w='
      );
    }

    nextXml = nextXml
      .replace(new RegExp(`(<\\/?)(?:${escapedPrefix}):`, 'g'), '$1w:')
      .replace(new RegExp(`(\\s)(?:${escapedPrefix}):`, 'g'), '$1w:');
  }

  return nextXml;
}

async function tryLoadDocx(buffer: Buffer): Promise<JSZip | null> {
  try {
    return await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
}

function replaceEditableMarkers(
  xml: string,
  controls: ControlMarker[]
): { xml: string; changed: boolean } {
  let changed = false;
  const nextXml = xml.replace(PARAGRAPH_PATTERN, (paragraphXml) => {
    const result = replaceEditableMarkersInParagraph(paragraphXml, controls);
    changed = changed || result.changed;
    return result.xml;
  });

  return { xml: nextXml, changed };
}

/**
 * Word splits a marker the author typed as one word across several runs
 * (revision ids, spell check, styling), so markers are matched against the
 * paragraph's combined `<w:t>` text and the token replaces the marker text in
 * whichever runs it spans.
 */
function replaceEditableMarkersInParagraph(
  paragraphXml: string,
  controls: ControlMarker[]
): { xml: string; changed: boolean } {
  const nodes = collectTextNodes(paragraphXml);
  if (nodes.length === 0) {
    return { xml: paragraphXml, changed: false };
  }

  const offsets: number[] = [];
  let combinedText = '';
  for (const node of nodes) {
    offsets.push(combinedText.length);
    combinedText += node.text;
  }

  const edits: { start: number; end: number; replacement: string }[] = [];

  for (const match of combinedText.matchAll(EDITABLE_MARKER_PATTERN)) {
    const markerStart = match.index;
    const markerEnd = markerStart + match[0].length;
    const index = controls.length;
    // `{{TEXTBOX: = expr}}` keeps `expr` as a template command so the engine
    // resolves it; the sentinels tell the post-process pass which merged text
    // becomes the control's editable default.
    const expression = DEFAULT_EXPRESSION_PATTERN.exec(match[2].trim())?.[1].trim();
    const token = expression
      ? `__DOCGEN_CONTROL_${index}_START__{{= ${expression} }}__DOCGEN_CONTROL_${index}_END__`
      : `__DOCGEN_CONTROL_${index}__`;
    controls.push({
      name: decodeXmlText(expression ?? match[2]).trim(),
      type: match[1].toUpperCase() === 'TEXTBOX' ? 'text' : 'date',
    });

    let tokenPlaced = false;
    for (const [index, node] of nodes.entries()) {
      const nodeStart = offsets[index];
      const overlapStart = Math.max(markerStart, nodeStart);
      const overlapEnd = Math.min(markerEnd, nodeStart + node.text.length);
      if (overlapStart >= overlapEnd) {
        continue;
      }

      edits.push({
        start: node.start + (overlapStart - nodeStart),
        end: node.start + (overlapEnd - nodeStart),
        replacement: tokenPlaced ? '' : token,
      });
      tokenPlaced = true;
    }
  }

  if (edits.length === 0) {
    return { xml: paragraphXml, changed: false };
  }

  let nextXml = paragraphXml;
  for (const edit of edits.reverse()) {
    nextXml = nextXml.slice(0, edit.start) + edit.replacement + nextXml.slice(edit.end);
  }

  return { xml: nextXml, changed: true };
}

function collectTextNodes(xml: string): { start: number; text: string }[] {
  return [...xml.matchAll(TEXT_NODE_PATTERN)].map((match) => ({
    start: match.index + match[0].indexOf('>') + 1,
    text: match[1],
  }));
}

function addRowSuppressionMarkers(
  xml: string,
  data: Record<string, unknown>,
  rowMarkers: RowMarker[]
): { xml: string; changed: boolean } {
  let changed = false;
  const nextXml = xml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (rowXml) => {
    const fieldPaths = extractSimpleFieldPaths(rowXml);
    if (fieldPaths.length === 0) {
      return rowXml;
    }
    if (fieldPaths.some((fieldPath) => !isRootDataPath(data, fieldPath))) {
      return rowXml;
    }

    const token = `__DOCGEN_ROW_${rowMarkers.length}__`;
    rowMarkers.push({
      token,
      remove: fieldPaths.every((fieldPath) => isBlankValue(resolvePath(data, fieldPath))),
    });

    const markedRow = rowXml.replace(
      /(<w:tc\b[^>]*>[\s\S]*?<w:p\b[^>]*>)/,
      `$1${hiddenMarkerRun(token)}`
    );
    changed = changed || markedRow !== rowXml;
    return markedRow;
  });

  return { xml: nextXml, changed };
}

function extractSimpleFieldPaths(xml: string): string[] {
  const fields = new Set<string>();
  const matches = xml.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);

  for (const match of matches) {
    const candidate = match[1].trim();
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(candidate)) {
      fields.add(candidate);
    }
  }

  return [...fields];
}

function extractWordText(xml: string): string {
  const texts: string[] = [];
  const matches = xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g);

  for (const match of matches) {
    texts.push(decodeXmlText(match[1]));
  }

  return texts.join('');
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function resolvePath(data: Record<string, unknown>, fieldPath: string): unknown {
  const directValue = fieldPath.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, data);

  if (directValue !== undefined || fieldPath.includes('.')) {
    return directValue;
  }

  const rootKeys = Object.keys(data);
  if (rootKeys.length === 1) {
    const rootValue = data[rootKeys[0]];
    if (rootValue && typeof rootValue === 'object' && fieldPath in rootValue) {
      return (rootValue as Record<string, unknown>)[fieldPath];
    }
  }

  return undefined;
}

function isRootDataPath(data: Record<string, unknown>, fieldPath: string): boolean {
  const firstPart = fieldPath.split('.')[0];
  if (firstPart.startsWith('$')) {
    return false;
  }
  if (firstPart in data) {
    return true;
  }
  if (fieldPath.includes('.')) {
    return false;
  }

  const rootKeys = Object.keys(data);
  if (rootKeys.length !== 1) {
    return false;
  }

  const rootValue = data[rootKeys[0]];
  return Boolean(rootValue && typeof rootValue === 'object' && fieldPath in rootValue);
}

function isBlankValue(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}

function hiddenMarkerRun(token: string): string {
  return `<w:r><w:rPr><w:vanish/></w:rPr><w:t>${token}</w:t></w:r>`;
}

async function postProcessXmlParts(zip: JSZip, context: DocxPostProcessContext): Promise<void> {
  const xmlPaths = Object.keys(zip.files).filter(isTemplateXmlPath);

  for (const path of xmlPaths) {
    const file = zip.file(path);
    if (!file) {
      continue;
    }

    let xml = await file.async('string');
    xml = applyRowSuppression(xml, context.rowMarkers);
    xml = applyRichTextToWordprocessingXml(xml);
    xml = removeEmptyTableCellParagraphs(xml);
    xml = removeRowlessTables(xml);
    xml = applyEditableControls(xml, context.controls);
    zip.file(path, xml);
  }
}

function applyRowSuppression(xml: string, rowMarkers: RowMarker[]): string {
  let nextXml = xml;

  for (const marker of rowMarkers) {
    const tokenPattern = escapeRegExp(marker.token);
    if (marker.remove) {
      nextXml = nextXml.replace(
        new RegExp(
          `<w:tr\\b(?:(?!<\\/w:tr>)[\\s\\S])*?${tokenPattern}(?:(?!<\\/w:tr>)[\\s\\S])*?<\\/w:tr>`,
          'g'
        ),
        ''
      );
    } else {
      nextXml = nextXml.replace(
        new RegExp(`<w:r\\b[^>]*>[\\s\\S]*?${tokenPattern}[\\s\\S]*?<\\/w:r>`, 'g'),
        ''
      );
      nextXml = nextXml.replace(new RegExp(tokenPattern, 'g'), '');
    }
  }

  return nextXml;
}

function removeEmptyTableCellParagraphs(xml: string): string {
  return xml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cellXml) => {
    let fallbackParagraph = '';
    const cleanedCellXml = cellXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
      if (!isRemovableEmptyParagraph(paragraphXml)) {
        return paragraphXml;
      }
      fallbackParagraph ||= paragraphXml;
      return '';
    });

    if (hasTableCellBlockContent(cleanedCellXml) || !fallbackParagraph) {
      return cleanedCellXml;
    }

    return cleanedCellXml.replace('</w:tc>', `${fallbackParagraph}</w:tc>`);
  });
}

function hasTableCellBlockContent(cellXml: string): boolean {
  return /<w:(?:p|tbl|sdt|altChunk)\b/.test(cellXml);
}

function removeRowlessTables(xml: string): string {
  return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tableXml) =>
    /<w:tr\b/.test(tableXml) ? tableXml : ''
  );
}

function isRemovableEmptyParagraph(paragraphXml: string): boolean {
  if (
    paragraphXml.includes('__DOCGEN_CONTROL_') ||
    /<w:(?:drawing|pict|object|sdt|fldSimple|br|tab)\b/.test(paragraphXml)
  ) {
    return false;
  }

  return extractWordText(paragraphXml).trim() === '';
}

function applyEditableControls(xml: string, controls: ControlMarker[]): string {
  if (controls.length === 0) {
    return xml;
  }

  const nextXml = xml.replace(RUN_PATTERN, (runXml) =>
    runXml.includes('__DOCGEN_CONTROL_') ? splitRunAtControls(runXml, controls) : runXml
  );

  return nextXml.replace(CONTROL_TOKEN_PATTERN, '');
}

/**
 * A `<w:sdt>` is a sibling of runs rather than run content, so the run holding
 * a token is rebuilt as prefix run + control + suffix run. Text either side of
 * the marker and the run's own formatting are carried over to both.
 */
function splitRunAtControls(runXml: string, controls: ControlMarker[]): string {
  const openTag = /^<w:r(?:\s[^>]*?)?>/.exec(runXml);
  if (!openTag) {
    return runXml;
  }

  const inner = runXml.slice(openTag[0].length, runXml.lastIndexOf('</w:r>'));
  const propertiesMatch = RUN_PROPERTIES_PATTERN.exec(inner);
  const runProperties = propertiesMatch ? propertiesMatch[1] : '';
  const body = propertiesMatch ? inner.slice(propertiesMatch[0].length) : inner;

  const pieces: string[] = [];
  let pendingBody = '';
  // Set while between a START and END sentinel: content accumulates into the
  // control's editable default instead of into a plain run.
  let capturing: { control: ControlMarker; body: string } | null = null;

  const append = (xml: string): void => {
    if (capturing) {
      capturing.body += xml;
    } else {
      pendingBody += xml;
    }
  };
  const flushRun = (): void => {
    if (hasRunContent(pendingBody)) {
      pieces.push(`${openTag[0]}${runProperties}${pendingBody}</w:r>`);
    }
    pendingBody = '';
  };

  let cursor = 0;
  for (const node of body.matchAll(TEXT_NODE_PATTERN)) {
    append(body.slice(cursor, node.index));
    cursor = node.index + node[0].length;

    if (!node[1].includes('__DOCGEN_CONTROL_')) {
      append(node[0]);
      continue;
    }

    let textCursor = 0;
    for (const token of node[1].matchAll(CONTROL_TOKEN_PATTERN)) {
      append(textNodeXml(node[1].slice(textCursor, token.index)));
      textCursor = token.index + token[0].length;
      const control = controls[Number(token[1])];
      if (!control) {
        continue;
      }

      if (token[2] === 'START') {
        flushRun();
        capturing = { control, body: '' };
      } else if (token[2] === 'END') {
        if (capturing) {
          pieces.push(contentControlXml(control, runProperties, capturing.body));
          capturing = null;
        }
      } else {
        flushRun();
        pieces.push(contentControlXml(control, runProperties));
      }
    }
    append(textNodeXml(node[1].slice(textCursor)));
  }

  append(body.slice(cursor));

  // A START with no END in this run: the merged value spanned runs or
  // paragraphs, so keep the text as-is rather than emit an unbalanced control.
  if (capturing) {
    pendingBody += capturing.body;
  }
  flushRun();

  return pieces.join('');
}

function textNodeXml(text: string): string {
  return text ? `<w:t xml:space="preserve">${text}</w:t>` : '';
}

function hasRunContent(runBody: string): boolean {
  return /<w:[a-zA-Z]/.test(runBody.replace(/<w:t(?:\s[^>]*?)?><\/w:t>/g, ''));
}

function contentControlXml(
  control: ControlMarker,
  runProperties = '',
  contentBody = ''
): string {
  const id = stableControlId(control.name);
  const escapedName = escapeXmlAttribute(control.name);
  const controlProperties =
    control.type === 'date'
      ? `<w:date><w:dateFormat w:val="M/d/yyyy"/><w:lid w:val="en-US"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`
      : '<w:text/>';

  const content = hasRunContent(contentBody) ? contentBody : '<w:t></w:t>';

  return `<w:sdt><w:sdtPr>${runProperties}<w:alias w:val="${escapedName}"/><w:tag w:val="${escapedName}"/><w:id w:val="${id}"/>${controlProperties}</w:sdtPr><w:sdtContent><w:r>${runProperties}${content}</w:r></w:sdtContent></w:sdt>`;
}

function stableControlId(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}

async function addDocumentProtection(zip: JSZip, editMode: string): Promise<void> {
  const protectionXml = `<w:documentProtection w:edit="${escapeXmlAttribute(editMode)}" w:enforcement="1"/>`;
  const settingsPath = 'word/settings.xml';
  const settingsFile = zip.file(settingsPath);
  let settingsXml = settingsFile
    ? await settingsFile.async('string')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>';

  settingsXml = ensureWordNamespace(settingsXml, 'w:settings');
  if (/<w:documentProtection\b[^>]*\/>/.test(settingsXml)) {
    settingsXml = settingsXml.replace(/<w:documentProtection\b[^>]*\/>/, protectionXml);
  } else {
    settingsXml = settingsXml.replace('</w:settings>', `${protectionXml}</w:settings>`);
  }

  zip.file(settingsPath, settingsXml);
  await ensureContentTypeOverride(zip, '/word/settings.xml', SETTINGS_CONTENT_TYPE);
  await ensureDocumentRelationship(zip, SETTINGS_REL_TYPE, 'settings.xml');
}

function shouldProtectDocument(options: ExtendedMergeOptions): boolean {
  if (typeof options.protection === 'boolean') {
    return options.protection;
  }

  return Boolean(
    options.readOnly ?? options.readOnlyWord ?? options.protect ?? options.protection?.enabled
  );
}

function getProtectionEditMode(options: ExtendedMergeOptions): string {
  return typeof options.protection === 'object' && options.protection.edit
    ? options.protection.edit
    : 'forms';
}

async function addWatermark(
  zip: JSZip,
  text: string,
  styleText?: string | null
): Promise<void> {
  const style = resolveWatermarkStyle(styleText);
  const headerPaths = Object.keys(zip.files).filter((path) => /^word\/header\d+\.xml$/.test(path));

  if (headerPaths.length === 0) {
    const headerPath = await createWatermarkHeader(zip, text, style);
    await attachHeaderToDocument(zip, headerPath);
    return;
  }

  for (const path of headerPaths) {
    const file = zip.file(path);
    if (!file) {
      continue;
    }
    const headerXml = addWatermarkToHeaderXml(await file.async('string'), text, style);
    zip.file(path, headerXml);
  }
}

async function createWatermarkHeader(
  zip: JSZip,
  text: string,
  style: WatermarkStyle
): Promise<string> {
  const headerNumber = nextPartNumber(zip, /^word\/header(\d+)\.xml$/);
  const headerPath = `word/header${headerNumber}.xml`;
  zip.file(
    headerPath,
    addWatermarkToHeaderXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:hdr>',
      text,
      style
    )
  );
  await ensureContentTypeOverride(zip, `/word/header${headerNumber}.xml`, HEADER_CONTENT_TYPE);
  return headerPath;
}

async function attachHeaderToDocument(zip: JSZip, headerPath: string): Promise<void> {
  const target = headerPath.replace('word/', '');
  const relationshipId = await ensureDocumentRelationship(zip, HEADER_REL_TYPE, target);
  const documentFile = zip.file(DOCUMENT_XML);
  if (!documentFile) {
    return;
  }

  let documentXml = await documentFile.async('string');
  documentXml = ensureRelationshipNamespace(documentXml);
  const headerReference = `<w:headerReference w:type="default" r:id="${relationshipId}"/>`;

  if (/<w:sectPr\b[^>]*>/.test(documentXml)) {
    documentXml = documentXml.replace(/(<w:sectPr\b[^>]*>)/, `$1${headerReference}`);
  } else {
    documentXml = documentXml.replace(
      '</w:body>',
      `<w:sectPr>${headerReference}</w:sectPr></w:body>`
    );
  }

  zip.file(DOCUMENT_XML, documentXml);
}

function addWatermarkToHeaderXml(
  headerXml: string,
  text: string,
  style: WatermarkStyle
): string {
  let nextXml = ensureWordNamespace(headerXml, 'w:hdr');
  nextXml = ensureNamespace(nextXml, 'w:hdr', 'xmlns:v', 'urn:schemas-microsoft-com:vml');
  nextXml = ensureNamespace(nextXml, 'w:hdr', 'xmlns:o', 'urn:schemas-microsoft-com:office:office');
  nextXml = ensureNamespace(nextXml, 'w:hdr', 'xmlns:w10', 'urn:schemas-microsoft-com:office:word');

  return nextXml.replace('</w:hdr>', `${watermarkParagraphXml(text, style)}</w:hdr>`);
}

function watermarkParagraphXml(text: string, style: WatermarkStyle): string {
  const escapedText = escapeXmlAttribute(text);
  return `<w:p><w:r><w:pict>${watermarkShapeTypeXml()}${watermarkShapeXml(escapedText, style)}</w:pict></w:r></w:p>`;
}

function watermarkShapeTypeXml(): string {
  return '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';
}

function watermarkShapeXml(escapedText: string, style: WatermarkStyle): string {
  const width = formatWatermarkNumber(style.width);
  const height = formatWatermarkNumber(style.height);
  const rotation = formatWatermarkNumber(toVmlRotation(style.rotation));
  const color = escapeXmlAttribute(style.color);
  const font = escapeXmlAttribute(style.font);
  return `<v:shape id="DocgenWatermark" o:spid="_x0000_s1025" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${width}pt;height:${height}pt;rotation:${rotation};z-index:251659264;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin;mso-wrap-edited:f" fillcolor="${color}" stroked="f"><v:fill/><v:textpath style="font-family:&quot;${font}&quot;;font-size:1pt" string="${escapedText}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape>`;
}

function resolveWatermarkStyle(styleText?: string | null): WatermarkStyle {
  const style: WatermarkStyle = { ...DEFAULT_WATERMARK_STYLE };
  const normalizedText = normalizeOptionText(styleText);
  if (!normalizedText) {
    return style;
  }

  for (const line of normalizedText.split(/\r?\n|;/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }

    const key = normalizeStyleKey(line.slice(0, separatorIndex));
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (key === 'font' || key === 'fontfamily') {
      style.font = normalizeFont(value, style.font);
    } else if (key === 'width') {
      style.width = normalizePositiveNumber(value, style.width);
    } else if (key === 'height') {
      style.height = normalizePositiveNumber(value, style.height);
    } else if (key === 'rotation') {
      style.rotation = normalizeNumber(value, style.rotation);
    } else if (key === 'color' || key === 'colorcode' || key === 'fillcolor') {
      style.color = normalizeColor(value, style.color);
    }
  }

  return style;
}

function normalizeStyleKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeFont(value: string, fallback: string): string {
  const normalized = value.trim().replace(/^["']|["']$/g, '');
  return normalized || fallback;
}

function normalizePositiveNumber(value: string, fallback: number): number {
  const normalized = normalizeNumber(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function normalizeNumber(value: string, fallback: number): number {
  const normalized = Number(value.trim().replace(/pt$/i, ''));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizeColor(value: string, fallback: string): string {
  const normalized = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)
    ? normalized.toUpperCase()
    : fallback;
}

function toVmlRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function formatWatermarkNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

async function ensureContentTypeOverride(
  zip: JSZip,
  partName: string,
  contentType: string
): Promise<void> {
  const file = zip.file(CONTENT_TYPES);
  if (!file) {
    return;
  }

  let xml = await file.async('string');
  if (xml.includes(`PartName="${partName}"`)) {
    return;
  }

  xml = xml.replace(
    '</Types>',
    `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`
  );
  zip.file(CONTENT_TYPES, xml);
}

async function ensureDocumentRelationship(
  zip: JSZip,
  relationshipType: string,
  target: string
): Promise<string> {
  const file = zip.file(DOCUMENT_RELS);
  let xml = file
    ? await file.async('string')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS_NAMESPACE}"></Relationships>`;

  const existing = [...xml.matchAll(/<Relationship\b[^>]*>/g)].find(
    (match) =>
      match[0].includes(`Type="${relationshipType}"`) && match[0].includes(`Target="${target}"`)
  );
  if (existing) {
    const idMatch = /Id="([^"]+)"/.exec(existing[0]);
    if (idMatch) {
      return idMatch[1];
    }
  }

  const nextId = nextRelationshipId(xml);
  xml = xml.replace(
    '</Relationships>',
    `<Relationship Id="${nextId}" Type="${relationshipType}" Target="${target}"/></Relationships>`
  );
  zip.file(DOCUMENT_RELS, xml);
  return nextId;
}

function nextRelationshipId(relsXml: string): string {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  return `rId${ids.length > 0 ? Math.max(...ids) + 1 : 1}`;
}

function nextPartNumber(zip: JSZip, pattern: RegExp): number {
  const numbers = Object.keys(zip.files)
    .map((path) => pattern.exec(path)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function ensureWordNamespace(xml: string, rootTag: string): string {
  return ensureNamespace(
    xml,
    rootTag,
    'xmlns:w',
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  );
}

function ensureRelationshipNamespace(xml: string): string {
  return ensureNamespace(
    xml,
    'w:document',
    'xmlns:r',
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  );
}

function ensureNamespace(xml: string, rootTag: string, attribute: string, value: string): string {
  if (xml.includes(`${attribute}=`)) {
    return xml;
  }

  return xml.replace(
    new RegExp(`<${rootTag}\\b([^>]*)>`),
    `<${rootTag}$1 ${attribute}="${value}">`
  );
}

function normalizeOptionText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
