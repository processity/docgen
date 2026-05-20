import JSZip from 'jszip';
import type { MergeOptions } from '../types';

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

export interface DocxPostProcessContext {
  controls: ControlMarker[];
  rowMarkers: RowMarker[];
  canPostProcess: boolean;
}

interface ControlMarker {
  token: string;
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
  const xmlPaths = Object.keys(zip.files).filter(isTemplateXmlPath);

  for (const path of xmlPaths) {
    const file = zip.file(path);
    if (!file) {
      continue;
    }

    let xml = await file.async('string');
    if (path === DOCUMENT_XML) {
      const rowResult = addRowSuppressionMarkers(xml, data, context.rowMarkers);
      xml = rowResult.xml;
      changed = changed || rowResult.changed;
    }

    const controlResult = replaceEditableMarkers(xml, context.controls);
    xml = controlResult.xml;
    changed = changed || controlResult.changed;

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
    await addWatermark(zip, watermarkText);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

function isTemplateXmlPath(path: string): boolean {
  return /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(path);
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
  const nextXml = xml.replace(
    /\{\{\s*(TEXTBOX|DATE|DATEBOX|DATEPICKER)\s*:\s*([^{}]+?)\s*\}\}/gi,
    (_, markerType: string, rawName: string) => {
      const token = `__DOCGEN_CONTROL_${controls.length}__`;
      controls.push({
        token,
        name: rawName.trim(),
        type: markerType.toUpperCase() === 'TEXTBOX' ? 'text' : 'date',
      });
      changed = true;
      return token;
    }
  );

  return { xml: nextXml, changed };
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

function resolvePath(data: Record<string, unknown>, fieldPath: string): unknown {
  return fieldPath.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, data);
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

function applyEditableControls(xml: string, controls: ControlMarker[]): string {
  let nextXml = xml;

  for (const control of controls) {
    const tokenPattern = escapeRegExp(control.token);
    const controlXml = contentControlXml(control);
    nextXml = nextXml.replace(
      new RegExp(`<w:r\\b[^>]*>[\\s\\S]*?${tokenPattern}[\\s\\S]*?<\\/w:r>`, 'g'),
      controlXml
    );
    nextXml = nextXml.replace(new RegExp(tokenPattern, 'g'), controlXml);
  }

  return nextXml;
}

function contentControlXml(control: ControlMarker): string {
  const id = stableControlId(control.name);
  const escapedName = escapeXmlAttribute(control.name);
  const controlProperties =
    control.type === 'date'
      ? `<w:date><w:dateFormat w:val="M/d/yyyy"/><w:lid w:val="en-US"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`
      : '<w:text/>';

  return `<w:sdt><w:sdtPr><w:alias w:val="${escapedName}"/><w:tag w:val="${escapedName}"/><w:id w:val="${id}"/>${controlProperties}</w:sdtPr><w:sdtContent><w:r><w:t></w:t></w:r></w:sdtContent></w:sdt>`;
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

async function addWatermark(zip: JSZip, text: string): Promise<void> {
  const headerPaths = Object.keys(zip.files).filter((path) => /^word\/header\d+\.xml$/.test(path));

  if (headerPaths.length === 0) {
    const headerPath = await createWatermarkHeader(zip, text);
    await attachHeaderToDocument(zip, headerPath);
    return;
  }

  for (const path of headerPaths) {
    const file = zip.file(path);
    if (!file) {
      continue;
    }
    const headerXml = addWatermarkToHeaderXml(await file.async('string'), text);
    zip.file(path, headerXml);
  }
}

async function createWatermarkHeader(zip: JSZip, text: string): Promise<string> {
  const headerNumber = nextPartNumber(zip, /^word\/header(\d+)\.xml$/);
  const headerPath = `word/header${headerNumber}.xml`;
  zip.file(
    headerPath,
    addWatermarkToHeaderXml(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:hdr>',
      text
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

function addWatermarkToHeaderXml(headerXml: string, text: string): string {
  let nextXml = ensureWordNamespace(headerXml, 'w:hdr');
  nextXml = ensureNamespace(nextXml, 'w:hdr', 'xmlns:v', 'urn:schemas-microsoft-com:vml');
  nextXml = ensureNamespace(nextXml, 'w:hdr', 'xmlns:o', 'urn:schemas-microsoft-com:office:office');

  return nextXml.replace('</w:hdr>', `${watermarkParagraphXml(text)}</w:hdr>`);
}

function watermarkParagraphXml(text: string): string {
  const escapedText = escapeXmlAttribute(text);
  return `<w:p><w:r><w:pict><v:shape id="DocgenWatermark" o:spid="_x0000_s1025" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:117pt;rotation:315;z-index:-251654144" fillcolor="silver" stroked="f"><v:fill opacity=".35"/><v:textpath style="font-family:Calibri;font-size:1pt" string="${escapedText}"/></v:shape></w:pict></w:r></w:p>`;
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
