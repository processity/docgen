const RICH_TEXT_TAG_PATTERN = /<\/?(p|div|br|b|strong|i|em|u|ul|ol|li|a)(\s|>|\/)/i;
const JAPANESE_TEXT_PATTERN = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const JAPANESE_FONT_FAMILY = 'Meiryo UI';
export const DOCGEN_LITERAL_XML_DELIMITER = '__DOCGEN_LITERAL_XML_BOUNDARY_8E31A9__';

interface RichTextRun {
  text?: string;
  lineBreak?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
}

interface ListState {
  type: 'ul' | 'ol';
  index: number;
}

/**
 * Converts Salesforce rich-text HTML strings in a data object into literal
 * WordprocessingML fragments that docx-templates can insert directly.
 */
export function prepareRichTextData<T>(
  value: T,
  literalXmlDelimiter = DOCGEN_LITERAL_XML_DELIMITER
): T {
  return transformRichTextValue(value, literalXmlDelimiter) as T;
}

function transformRichTextValue(value: unknown, literalXmlDelimiter: string): unknown {
  if (typeof value === 'string') {
    return htmlToWordprocessingMl(value, literalXmlDelimiter) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => transformRichTextValue(item, literalXmlDelimiter));
  }

  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [
        key,
        transformRichTextValue(childValue, literalXmlDelimiter),
      ])
    );
  }

  return value;
}

export function htmlToWordprocessingMl(
  html: string,
  literalXmlDelimiter = DOCGEN_LITERAL_XML_DELIMITER
): string | null {
  if (!RICH_TEXT_TAG_PATTERN.test(html)) {
    return null;
  }

  const paragraphs = parseRichTextHtml(html);
  if (paragraphs.length === 0) {
    return '';
  }

  const paragraphXml = paragraphs.map(runsToParagraphContentXml).join('</w:p><w:p>');
  return `${literalXmlDelimiter}</w:t></w:r>${paragraphXml}<w:r><w:t xml:space="preserve">${literalXmlDelimiter}`;
}

/**
 * Converts rich-text HTML inserted as ordinary Word text after docx-templates
 * has finished evaluating template JavaScript. This keeps the original HTML
 * available to template helper functions while still supporting direct field
 * insertion such as {{= $cl.Text__c }}.
 */
export function applyRichTextToWordprocessingXml(xml: string): string {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const html = extractParagraphText(paragraphXml);
    if (!RICH_TEXT_TAG_PATTERN.test(html)) {
      return paragraphXml;
    }

    const paragraphs = parseRichTextHtml(html);
    if (paragraphs.length === 0) {
      return paragraphXml;
    }

    const openingTag = /^<w:p\b[^>]*>/.exec(paragraphXml)?.[0] ?? '<w:p>';
    const paragraphProperties = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(paragraphXml)?.[0] ?? '';
    const baseRunProperties =
      /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(paragraphXml)?.[0] ?? '';

    return paragraphs
      .map((runs, index) => {
        const properties =
          index === 0
            ? paragraphProperties
            : createContinuationParagraphProperties(paragraphProperties);
        return `${openingTag}${properties}${runs
          .map((run) => runToXml(run, baseRunProperties))
          .join('')}</w:p>`;
      })
      .join('');
  });
}

function createContinuationParagraphProperties(paragraphProperties: string): string {
  const hasNumbering = /<w:numPr\b/.test(paragraphProperties);
  const properties = paragraphProperties.replace(
    /<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>|<w:numPr\b[^>]*\/>/g,
    ''
  );
  if (!hasNumbering) {
    return properties;
  }

  return properties.replace(/<w:ind\b[^>]*>/g, (indent) =>
    indent.replace(
      /\s+w:(?:hanging|hangingChars|firstLine|firstLineChars)\s*=\s*(?:"[^"]*"|'[^']*')/g,
      ''
    )
  );
}

function parseRichTextHtml(html: string): RichTextRun[][] {
  const paragraphs: RichTextRun[][] = [];
  let currentRuns: RichTextRun[] = [];
  const listStack: ListState[] = [];
  const fontFamily = JAPANESE_TEXT_PATTERN.test(html) ? JAPANESE_FONT_FAMILY : undefined;
  let boldDepth = 0;
  let italicDepth = 0;
  let underlineDepth = 0;

  const pushParagraph = (): void => {
    if (currentRuns.some((run) => run.lineBreak || (run.text && run.text.trim() !== ''))) {
      paragraphs.push(currentRuns);
    }
    currentRuns = [];
  };

  const pushText = (rawText: string): void => {
    const text = normalizeText(decodeHtmlEntities(rawText));
    if (!text) {
      return;
    }

    currentRuns.push({
      text,
      bold: boldDepth > 0,
      italic: italicDepth > 0,
      underline: underlineDepth > 0,
      fontFamily,
    });
  };

  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      pushText(token);
      continue;
    }

    const tag = parseTag(token);
    if (!tag) {
      continue;
    }

    switch (tag.name) {
      case 'p':
      case 'div':
        if (tag.closing) {
          pushParagraph();
        } else if (currentRuns.length > 0) {
          pushParagraph();
        }
        break;
      case 'br':
        currentRuns.push({ lineBreak: true });
        break;
      case 'b':
      case 'strong':
        boldDepth = tag.closing ? Math.max(0, boldDepth - 1) : boldDepth + 1;
        break;
      case 'i':
      case 'em':
        italicDepth = tag.closing ? Math.max(0, italicDepth - 1) : italicDepth + 1;
        break;
      case 'u':
        underlineDepth = tag.closing ? Math.max(0, underlineDepth - 1) : underlineDepth + 1;
        break;
      case 'ul':
      case 'ol':
        if (tag.closing) {
          listStack.pop();
          pushParagraph();
        } else {
          listStack.push({ type: tag.name, index: 0 });
        }
        break;
      case 'li':
        if (tag.closing) {
          pushParagraph();
        } else {
          if (currentRuns.length > 0) {
            pushParagraph();
          }
          const list = listStack[listStack.length - 1];
          if (list?.type === 'ol') {
            list.index += 1;
            pushText(`${list.index}. `);
          } else {
            pushText('- ');
          }
        }
        break;
      case 'a':
        break;
      default:
        break;
    }
  }

  pushParagraph();
  return paragraphs;
}

function parseTag(token: string): { name: string; closing: boolean } | null {
  const match = /^<\s*(\/)?\s*([a-zA-Z0-9]+)/.exec(token);
  if (!match) {
    return null;
  }

  return {
    closing: Boolean(match[1]),
    name: match[2].toLowerCase(),
  };
}

function runsToParagraphContentXml(runs: RichTextRun[]): string {
  const xml = runs.map((run) => runToXml(run)).join('');
  return xml || '<w:r><w:t></w:t></w:r>';
}

function runToXml(run: RichTextRun, baseRunProperties = ''): string {
  const runProperties = mergeRunProperties(baseRunProperties, run);

  if (run.lineBreak) {
    return `<w:r>${runProperties}<w:br/></w:r>`;
  }

  return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXmlText(
    run.text ?? ''
  )}</w:t></w:r>`;
}

function mergeRunProperties(baseRunProperties: string, run: RichTextRun): string {
  let properties = baseRunProperties
    .replace(/^<w:rPr\b[^>]*>|<\/w:rPr>$/g, '')
    .replace(/<w:rFonts\b[^>]*\/>/g, '')
    .replace(/<w:b(?:Cs)?\b[^>]*\/>/g, '')
    .replace(/<w:i(?:Cs)?\b[^>]*\/>/g, '')
    .replace(/<w:u\b[^>]*\/>/g, '');

  properties = [
    properties,
    run.fontFamily
      ? `<w:rFonts w:ascii="${run.fontFamily}" w:hAnsi="${run.fontFamily}" w:eastAsia="${run.fontFamily}" w:cs="${run.fontFamily}" w:hint="eastAsia"/>`
      : '',
    run.bold ? '<w:b/><w:bCs/>' : '',
    run.italic ? '<w:i/><w:iCs/>' : '',
    run.underline ? '<w:u w:val="single"/>' : '',
  ].join('');

  return properties ? `<w:rPr>${properties}</w:rPr>` : '';
}

function normalizeText(text: string): string {
  const normalized = text.replace(/[ \t\r\n\f]+/g, ' ');
  return normalized.trim() === '' ? '' : normalized;
}

function extractParagraphText(paragraphXml: string): string {
  const content: string[] = [];
  const matches = paragraphXml.matchAll(
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>/g
  );

  for (const match of matches) {
    content.push(match[1] === undefined ? '\n' : decodeXmlText(match[1]));
  }

  return content.join('');
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)));
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
