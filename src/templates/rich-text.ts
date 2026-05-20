const RICH_TEXT_TAG_PATTERN = /<\/?(p|div|br|b|strong|i|em|u|ul|ol|li|a)(\s|>|\/)/i;

interface RichTextRun {
  text?: string;
  lineBreak?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface ListState {
  type: 'ul' | 'ol';
  index: number;
}

/**
 * Converts Salesforce rich-text HTML strings in a data object into literal
 * WordprocessingML fragments that docx-templates can insert directly.
 */
export function prepareRichTextData<T>(value: T, literalXmlDelimiter = '||'): T {
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

export function htmlToWordprocessingMl(html: string, literalXmlDelimiter = '||'): string | null {
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

function parseRichTextHtml(html: string): RichTextRun[][] {
  const paragraphs: RichTextRun[][] = [];
  let currentRuns: RichTextRun[] = [];
  const listStack: ListState[] = [];
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
  const xml = runs.map(runToXml).join('');
  return xml || '<w:r><w:t></w:t></w:r>';
}

function runToXml(run: RichTextRun): string {
  if (run.lineBreak) {
    return '<w:r><w:br/></w:r>';
  }

  const properties = [
    run.bold ? '<w:b/>' : '',
    run.italic ? '<w:i/>' : '',
    run.underline ? '<w:u w:val="single"/>' : '',
  ].join('');
  const runProperties = properties ? `<w:rPr>${properties}</w:rPr>` : '';

  return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXmlText(run.text ?? '')}</w:t></w:r>`;
}

function normalizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ');
  return normalized.trim() === '' ? '' : normalized;
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
