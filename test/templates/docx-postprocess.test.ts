import JSZip from 'jszip';
import { applyWatermarkToDocx } from '../../src/templates/docx-postprocess';
import { mergeTemplate } from '../../src/templates/merge';
import { applyRichTextToWordprocessingXml } from '../../src/templates/rich-text';
import type { MergeOptions } from '../../src/types';
import { createTestDocxFromBodyXml, readDocxXml } from '../helpers/test-docx';

describe('DOCX template post-processing', () => {
  const baseOptions: MergeOptions = {
    locale: 'en-US',
    timezone: 'America/New_York',
  };

  it('converts Salesforce rich-text HTML to WordprocessingML literal XML', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{Account.Description}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Account: {
          Description: '<p>Hello <strong>Bold</strong><br/><em>Italic</em></p><p><u>Under</u></p>',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('<w:b/>');
    expect(documentXml).toContain('<w:i/>');
    expect(documentXml).toContain('<w:u w:val="single"/>');
    expect(documentXml).toContain('<w:br/>');
    expect(documentXml).toContain('<w:t xml:space="preserve">Bold</w:t>');
    expect(documentXml).not.toContain('altChunk');
    expect(documentXml).not.toContain('Meiryo UI');
  });

  it('uses Meiryo UI and preserves bold styling for Japanese rich text', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:pPr><w:spacing w:line="276"/></w:pPr>
        <w:r>
          <w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial"/><w:sz w:val="17"/></w:rPr>
          <w:t>{{Clause.Text__c}}</w:t>
        </w:r>
      </w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Clause: {
          Text__c: '<p><strong>ガバナンス</strong> 本注文書に適用されます。</p>',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const fontProperties =
      '<w:rFonts w:ascii="Meiryo UI" w:hAnsi="Meiryo UI" w:eastAsia="Meiryo UI" w:cs="Meiryo UI" w:hint="eastAsia"/>';

    expect(documentXml).toContain(`${fontProperties}<w:b/>`);
    expect(documentXml).toContain('<w:sz w:val="17"/>');
    expect(documentXml).toContain('<w:spacing w:line="276"/>');
    expect(documentXml).toContain('<w:t xml:space="preserve">ガバナンス</w:t>');
    expect(documentXml).toContain('<w:t xml:space="preserve"> 本注文書に適用されます。</w:t>');
    expect(documentXml.match(/w:eastAsia="Meiryo UI"/g)).toHaveLength(2);
  });

  it('decodes HTML entities in rich-text fields that contain no markup', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{Quote.FlowDown}}</w:t></w:r></w:p>
      <w:p><w:r><w:t>{{Quote.Advocacy}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Quote: {
          // Verbatim Commercial_Clause__c.Text__c values from OTO-4032.
          FlowDown:
            'Customer’s use of the Products Bundle is governed by this Schedule which supplements the terms and conditions of the Public Sector EULA (the &quot;Agreement&quot;).',
          Advocacy:
            'Distributor authorizes UiPath to publicly identify it as a distributor and include Distributor’s name, trademarks, and logo on UiPath&#39;s website.',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('the "Agreement").');
    expect(documentXml).toContain("on UiPath's website.");
    expect(documentXml).not.toContain('&amp;quot;');
    expect(documentXml).not.toContain('&amp;#39;');
  });

  it('keeps the merged document well-formed when decoding entities', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{Clause.Text__c}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Clause: {
          // `&amp;` must survive as a literal ampersand, and an escaped entity
          // must not be decoded a second time.
          Text__c:
            'R&amp;D &quot;unit&quot; UiPath&apos;s &lt;tag&gt; &amp;quot; &nbsp;&mdash;&rsquo;end',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const paragraph = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []).find((candidate) =>
      candidate.includes('R&amp;D')
    );

    expect(paragraph).toContain('R&amp;D "unit" UiPath\'s &lt;tag&gt; &amp;quot;  —’end');
    // Every ampersand left in the part must be a valid XML entity reference.
    expect(documentXml).not.toMatch(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);)/i);
  });

  it('leaves numeric references XML cannot store as written', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{Clause.Text__c}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        // A NUL, a lone surrogate and an out-of-range code point would each
        // produce a file Word refuses to open, so they stay literal.
        Clause: { Text__c: 'a&#0;b&#xD800;c&#99999999;d&#8212;e' },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const paragraph = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []).find((candidate) =>
      candidate.includes('a&amp;#0;b')
    );

    expect(paragraph).toContain('a&amp;#0;b&amp;#xD800;c&amp;#99999999;d—e');
    expect(documentXml).not.toMatch(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);)/i);
  });

  it('leaves paragraphs without HTML entities untouched', () => {
    // `&amp;`/`&lt;` are XML escaping, not HTML entities, so nothing should be
    // rewritten here — decoding and re-escaping is not a byte-identical round trip.
    const staticParagraph =
      '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">Tom &amp; Jerry said &quot;hi&quot; &lt;here&gt; M&amp;M;s</w:t></w:r></w:p>';

    expect(applyRichTextToWordprocessingXml(staticParagraph)).toBe(staticParagraph);
  });

  it('preserves template paragraph formatting on every rich-text paragraph', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="ClauseText"/>
          <w:spacing w:after="120"/>
          <w:jc w:val="both"/>
        </w:pPr>
        <w:r><w:t>Static introduction. {{Clause.Text__c}} Static conclusion.</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Clause: {
          Text__c: '<p>First justified paragraph.</p><p>Second justified paragraph.</p>',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const generatedParagraphs = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []).filter(
      (paragraph) => paragraph.includes('justified paragraph') || paragraph.includes('Static')
    );

    expect(generatedParagraphs).toHaveLength(4);
    for (const paragraph of generatedParagraphs) {
      expect(paragraph).toContain('<w:pStyle w:val="ClauseText"/>');
      expect(paragraph).toContain('<w:spacing w:after="120"/>');
      expect(paragraph).toContain('<w:jc w:val="both"/>');
    }
  });

  it('keeps numbering only on the first paragraph expanded from rich text', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="ClauseText"/>
          <w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>
          <w:spacing w:after="120"/>
          <w:ind w:left="0" w:hanging="357"/>
          <w:jc w:val="both"/>
        </w:pPr>
        <w:r><w:t>{{Clause.Text__c}}</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Clause: {
          Text__c:
            '<p><strong>RCM Platform Units.</strong> First paragraph.</p><p><br></p><p>Continuation paragraph.</p>',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const generatedParagraphs = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []).filter(
      (paragraph) =>
        paragraph.includes('RCM Platform Units.') ||
        paragraph.includes('<w:br/>') ||
        paragraph.includes('Continuation paragraph.')
    );

    expect(generatedParagraphs).toHaveLength(3);
    expect(generatedParagraphs[0]).toContain('<w:numPr>');
    expect(generatedParagraphs[0]).toContain('w:hanging="357"');
    expect(generatedParagraphs[1]).not.toContain('<w:numPr>');
    expect(generatedParagraphs[2]).not.toContain('<w:numPr>');
    expect(generatedParagraphs[1]).not.toContain('w:hanging=');
    expect(generatedParagraphs[2]).not.toContain('w:hanging=');
    expect(generatedParagraphs[1]).toContain('<w:br/>');

    for (const paragraph of generatedParagraphs) {
      expect(paragraph).toContain('<w:pStyle w:val="ClauseText"/>');
      expect(paragraph).toContain('<w:spacing w:after="120"/>');
      expect(paragraph).toContain('w:left="0"');
      expect(paragraph).toContain('<w:jc w:val="both"/>');
    }
  });

  it('preserves justification on ordinary template text after field merging', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:pPr><w:jc w:val="both"/></w:pPr>
        <w:r><w:t>Static text before {{Account.Name}} and after.</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(template, { Account: { Name: 'Acme' } }, baseOptions);

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const paragraph = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []).find(
      (candidate) =>
        candidate.includes('Static text before ') &&
        candidate.includes('Acme') &&
        candidate.includes(' and after.')
    );

    expect(paragraph).toContain('<w:jc w:val="both"/>');
  });

  it('keeps rich-text HTML raw for template helper functions', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{EXEC
        title = function(html) {
          var match = String(html || '').match(/&lt;strong&gt;([\\s\\S]*?)&lt;\\/strong&gt;/i);
          return match ? match[1] : '';
        };
        body = function(html) {
          return String(html || '')
            .replace(/&lt;strong&gt;[\\s\\S]*?&lt;\\/strong&gt;/i, '')
            .replace(/&lt;\\/?p&gt;/gi, '');
        };
      }}</w:t></w:r></w:p>
      <w:p>
        <w:r><w:rPr><w:b/></w:rPr><w:t>{{= title(Clause.Text__c) }}</w:t></w:r>
        <w:r><w:t>{{= body(Clause.Text__c) }}</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Clause: {
          Text__c: '<p><strong>ガバナンス</strong>　本注文書に適用されます。</p>',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const runs = documentXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? [];
    const titleRun = runs.find((run) => run.includes('ガバナンス'));
    const bodyRun = runs.find((run) => run.includes('本注文書に適用されます。'));
    expect(titleRun).toContain('<w:b/>');
    expect(bodyRun).not.toContain('<w:b/>');
    expect(documentXml).not.toContain('&lt;strong&gt;');
  });

  it('converts direct rich-text fields inside loops after template evaluation', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{FOR cl IN Quote.Clauses}}</w:t></w:r></w:p>
      <w:p>
        <w:r><w:rPr><w:sz w:val="17"/></w:rPr><w:t>{{= $cl.Text__c }}</w:t></w:r>
      </w:p>
      <w:p><w:r><w:t>{{END-FOR cl}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Quote: {
          Clauses: [
            {
              Text__c: '<p><strong>ガバナンス</strong>　本文一</p>',
            },
            {
              Text__c: '<p><strong>支払い</strong>　本文二</p>',
            },
          ],
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('<w:t xml:space="preserve">ガバナンス</w:t>');
    expect(documentXml).toContain('<w:t xml:space="preserve">支払い</w:t>');
    expect(documentXml.match(/<w:b\/>/g)).toHaveLength(2);
    expect(documentXml.match(/w:eastAsia="Meiryo UI"/g)).toHaveLength(4);
    expect(documentXml.match(/<w:sz w:val="17"\/>/g)).toHaveLength(4);
    expect(documentXml).not.toContain('&lt;strong&gt;');
  });

  it('converts editable markers to content controls and enables forms protection', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{TEXTBOX:Approver}}</w:t></w:r></w:p>
      <w:p><w:r><w:t>{{DATEPICKER:Review Date}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(template, {}, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const settingsXml = await readDocxXml(result, 'word/settings.xml');
    expect(documentXml).toContain('<w:sdt>');
    expect(documentXml).toContain('<w:text/>');
    expect(documentXml).toContain('<w:date>');
    expect(documentXml).toContain('w:val="Approver"');
    expect(documentXml).toContain('w:val="Review Date"');
    expect(documentXml).not.toContain('TEXTBOX:Approver');
    expect(documentXml).not.toContain('DATEPICKER:Review Date');
    expect(settingsXml).toContain('<w:documentProtection w:edit="forms" w:enforcement="1"/>');
  });

  it('converts editable markers Word split across several runs', async () => {
    const runProperties = '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>';
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:proofErr w:type="spellStart"/>
        <w:r>${runProperties}<w:t>{{</w:t></w:r>
        <w:r>${runProperties}<w:t>TEXTBOX</w:t></w:r>
        <w:proofErr w:type="spellEnd"/>
        <w:r>${runProperties}<w:t>:</w:t></w:r>
        <w:r>${runProperties}<w:t>Partner Signature</w:t></w:r>
        <w:r>${runProperties}<w:t>}}</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(template, {}, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('w:val="Partner Signature"');
    expect(documentXml).not.toContain('__DOCGEN_CONTROL_');
    expect(documentXml).toMatch(/<w:sdtPr><w:rPr>\s*<w:b\/>/);
    expect(documentXml).toMatch(/<w:sdtContent><w:r><w:rPr>\s*<w:b\/>/);
  });

  it('keeps text around editable markers and converts every marker in a paragraph', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:r><w:t xml:space="preserve">Name: {{TEXT</w:t></w:r>
        <w:r><w:t>BOX:Name</w:t></w:r>
        <w:r><w:t xml:space="preserve">}} Title: {{TEXTBOX:Title}}</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(template, {}, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('<w:t xml:space="preserve">Name: </w:t>');
    expect(documentXml).toContain('<w:t xml:space="preserve"> Title: </w:t>');
    expect(documentXml).toContain('w:val="Name"');
    expect(documentXml).toContain('w:val="Title"');
    expect(documentXml.match(/<w:sdt>/g)).toHaveLength(2);
  });

  it('prefills an editable control from a marker expression', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">By: {{TEXT</w:t></w:r>
        <w:r><w:rPr><w:b/></w:rPr><w:t>BOX: = partnerLegal</w:t></w:r>
        <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Name }} (partner)</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(template, { partnerLegalName: 'Contoso Ltd' }, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('w:val="partnerLegalName"');
    expect(documentXml).toMatch(
      /<w:sdtContent><w:r><w:rPr>\s*<w:b\/>\s*<\/w:rPr>\s*<w:t xml:space="preserve">Contoso Ltd<\/w:t>\s*<\/w:r><\/w:sdtContent>/
    );
    expect(documentXml).toContain('<w:t xml:space="preserve">By: </w:t>');
    expect(documentXml).toContain('<w:t xml:space="preserve"> (partner)</w:t>');
    expect(documentXml).not.toContain('__DOCGEN_CONTROL_');
  });

  it('accepts INS as well as = in a marker expression', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{TEXTBOX: INS Account.Name }}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(template, { Account: { Name: 'Acme' } }, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('w:val="Account.Name"');
    expect(documentXml).toContain('<w:t xml:space="preserve">Acme</w:t>');
  });

  it('leaves the control empty when a prefill expression cannot be resolved', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t xml:space="preserve">Entity: {{TEXTBOX: = uipathSigningEntity }}</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Partner: {{TEXTBOX: = Account.Missing }}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(template, { Account: {} }, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('w:val="uipathSigningEntity"');
    expect(documentXml).toContain('w:val="Account.Missing"');
    expect(documentXml).toContain('<w:t xml:space="preserve">Entity: </w:t>');
    expect(documentXml).not.toContain('__DOCGEN_PREFILL_UNRESOLVED__');
    expect(documentXml.match(/<w:sdtContent><w:r><w:t><\/w:t><\/w:r><\/w:sdtContent>/g)).toHaveLength(2);
  });

  it('still fails loudly when a plain data field cannot be resolved', async () => {
    const template = await createTestDocxFromBodyXml(
      `<w:p><w:r><w:t>{{= uipathSigningEntity }}</w:t></w:r></w:p>`
    );

    await expect(
      mergeTemplate(template, {}, { ...baseOptions, readOnly: true } as MergeOptions & {
        readOnly: boolean;
      })
    ).rejects.toThrow(/uipathSigningEntity/);
  });

  it('keeps merged content when a prefill value spans paragraphs', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t xml:space="preserve">Clause: {{TEXTBOX: = Clause.Text__c }} end</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      { Clause: { Text__c: '<p>First para</p><p>Second para</p>' } },
      { ...baseOptions, readOnly: true } as MergeOptions & { readOnly: boolean }
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('First para');
    expect(documentXml).toContain('Second para');
    expect(documentXml).not.toContain('__DOCGEN_CONTROL_');
    expect(documentXml).not.toContain('<w:sdt>');
  });

  it('leaves data fields split across runs to the template engine', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p>
        <w:r><w:t>{{Account.</w:t></w:r>
        <w:r><w:t>Name}}</w:t></w:r>
      </w:p>
    `);

    const result = await mergeTemplate(template, { Account: { Name: 'Acme' } }, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('Acme');
    expect(documentXml).not.toContain('<w:sdt>');
  });

  it('inserts document protection at its schema position in settings.xml', async () => {
    // CT_Settings is an ordered sequence: evenAndOddHeaders and compat must
    // follow w:documentProtection, so appending at the end is invalid and Word
    // discards the protection.
    const template = await createTestDocxFromBodyXml(
      `<w:p><w:r><w:t>{{TEXTBOX:Approver}}</w:t></w:r></w:p>`
    );
    const zip = await JSZip.loadAsync(template);
    zip.file(
      'word/settings.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:displayBackgroundShape/><w:evenAndOddHeaders w:val="true"/>' +
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="x" w:val="15"/></w:compat>' +
        '</w:settings>'
    );

    const result = await mergeTemplate(await zip.generateAsync({ type: 'nodebuffer' }), {}, {
      ...baseOptions,
      readOnly: true,
    } as MergeOptions & { readOnly: boolean });

    const settingsXml = await readDocxXml(result, 'word/settings.xml');
    expect(settingsXml).toContain('<w:documentProtection w:edit="forms" w:enforcement="1"/>');
    expect(settingsXml.indexOf('<w:documentProtection')).toBeGreaterThan(
      settingsXml.indexOf('<w:displayBackgroundShape')
    );
    expect(settingsXml.indexOf('<w:documentProtection')).toBeLessThan(
      settingsXml.indexOf('<w:evenAndOddHeaders')
    );
  });

  it('inserts watermark XML into a generated header when requested', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{Account.Name}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(template, { Account: { Name: 'Acme' } }, {
      ...baseOptions,
      watermarkText: 'DRAFT',
    } as MergeOptions & { watermarkText: string });

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const headerXml = await readDocxXml(result, 'word/header1.xml');
    expect(documentXml).toContain('<w:headerReference w:type="default" r:id="');
    expect(headerXml).toContain('<v:shape');
    expect(headerXml).toContain('DocgenWatermark');
    expect(headerXml).toContain('<v:shapetype id="_x0000_t136"');
    expect(headerXml).toContain('mso-position-horizontal:center');
    expect(headerXml).toContain('mso-position-vertical:center');
    expect(headerXml).toContain('width:350pt');
    expect(headerXml).toContain('height:50pt');
    expect(headerXml).toContain('rotation:315');
    expect(headerXml).toContain('fillcolor="#808080"');
    expect(headerXml).toContain('font-family:&quot;Courier&quot;');
    expect(headerXml).toContain('<w10:wrap anchorx="margin" anchory="margin"/>');
    expect(headerXml).toContain('string="DRAFT"');
  });

  it('uses configured watermark style values when supplied', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{Account.Name}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(template, { Account: { Name: 'Acme' } }, {
      ...baseOptions,
      watermarkText: 'DRAFT',
      watermarkStyle: 'Font: Arial\nWidth: 400\nHeight: 60\nRotation: -30\nColor code: #112233',
    } as MergeOptions & { watermarkText: string; watermarkStyle: string });

    const headerXml = await readDocxXml(result, 'word/header1.xml');
    expect(headerXml).toContain('width:400pt');
    expect(headerXml).toContain('height:60pt');
    expect(headerXml).toContain('rotation:330');
    expect(headerXml).toContain('fillcolor="#112233"');
    expect(headerXml).toContain('font-family:&quot;Arial&quot;');
  });

  it('can apply a watermark to an already merged DOCX', async () => {
    const docx = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>Composite output</w:t></w:r></w:p>
    `);

    const result = await applyWatermarkToDocx(
      docx,
      'COMPOSITE',
      'Font: Arial\nWidth: 400\nHeight: 60\nRotation: -30\nColor code: #112233'
    );

    const headerXml = await readDocxXml(result, 'word/header1.xml');
    expect(headerXml).toContain('string="COMPOSITE"');
    expect(headerXml).toContain('width:400pt');
    expect(headerXml).toContain('height:60pt');
    expect(headerXml).toContain('rotation:330');
    expect(headerXml).toContain('fillcolor="#112233"');
  });

  it('removes table rows whose simple field paths resolve blank', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Keep {{Account.Name}}</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Remove {{Account.EmptyField}}</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `);

    const result = await mergeTemplate(
      template,
      { Account: { Name: 'Acme', EmptyField: null } },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('Keep ');
    expect(documentXml).toContain('Acme');
    expect(documentXml).not.toContain('Remove');
    expect(documentXml).not.toContain('__DOCGEN_ROW_');
  });

  it('collapses blank address lines inside a populated table row', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Ship To Address:</w:t></w:r></w:p></w:tc>
          <w:tc>
            <w:p><w:r><w:t>{{Quote.Street}}</w:t></w:r></w:p>
            <w:p><w:r><w:t>{{Quote.City}}</w:t></w:r></w:p>
            <w:p><w:r><w:t>{{Quote.State}}</w:t></w:r></w:p>
            <w:p><w:r><w:t>{{Quote.Country}}</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `);

    const result = await mergeTemplate(
      template,
      {
        Quote: {
          Street: '16 Great Marlborough Street',
          City: 'London',
          State: '',
          Country: 'United Kingdom',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('Ship To Address:');
    expect(documentXml).toContain('16 Great Marlborough Street');
    expect(documentXml).toContain('London');
    expect(documentXml).toContain('United Kingdom');
    expect(documentXml).not.toContain('Quote.State');
    expect(documentXml).not.toContain('__DOCGEN_PARAGRAPH_');
    expect(documentXml.match(/<w:p\b/g) ?? []).toHaveLength(4);
  });

  it('keeps a valid paragraph when a table cell has only blank values', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Account {{Account.Name}}</w:t></w:r></w:p></w:tc>
          <w:tc>
            <w:p><w:r><w:t>{{Account.OptionalLine1}}</w:t></w:r></w:p>
            <w:p><w:r><w:t>{{Account.OptionalLine2}}</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `);

    const result = await mergeTemplate(
      template,
      {
        Account: {
          Name: 'Acme',
          OptionalLine1: null,
          OptionalLine2: '',
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    const cells = documentXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[1].match(/<w:p\b/g) ?? []).toHaveLength(1);
    expect(cells[1]).not.toContain('OptionalLine');
  });

  it('treats null loop collections as empty arrays and removes rowless tables', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>{{FOR item IN Account.LineItems}}</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>{{INS $item.Name}}</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>{{END-FOR item}}</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      <w:p><w:r><w:t>After table</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      {
        Account: {
          Name: 'Acme',
          LineItems: null,
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('After table');
    expect(documentXml).not.toContain('<w:tbl');
    expect(documentXml).not.toContain('LineItems');
    expect(documentXml).not.toContain('$item');
  });

  it('treats missing nested loop collections as empty arrays', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>{{FOR item IN Account.LineItems}}</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>{{INS $item.Name}}</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>{{END-FOR item}}</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      <w:p><w:r><w:t>After table</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(template, { Account: { Name: 'Acme' } }, baseOptions);

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('After table');
    expect(documentXml).not.toContain('<w:tbl');
  });

  it('does not suppress repeated rows that use loop-scoped fields', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>{{FOR item IN Account.LineItems}}</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>{{INS $item.Name}}</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>{{INS $item.Amount}}</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>{{END-FOR item}}</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
    `);

    const result = await mergeTemplate(
      template,
      {
        Account: {
          LineItems: [
            { Name: 'Service A', Amount: '100' },
            { Name: 'Service B', Amount: '200' },
          ],
        },
      },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('Service A');
    expect(documentXml).toContain('Service B');
    expect(documentXml).not.toContain('__DOCGEN_ROW_');
  });

  it('does not shadow collections created by template EXEC commands', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{EXEC generatedSections = [{ rows: [{ Name: 'Generated row' }] }]}}</w:t></w:r></w:p>
      <w:p><w:r><w:t>{{FOR section IN generatedSections}}</w:t></w:r></w:p>
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>{{FOR item IN $section.rows}}{{INS $item.Name}}{{END-FOR item}}</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      <w:p><w:r><w:t>{{END-FOR section}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(template, { Account: { Name: 'Acme' } }, baseOptions);

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('Generated row');
  });

  it('normalizes WordprocessingML namespace aliases before merging commands', async () => {
    const canonicalTemplate = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{EXEC items = Account.Items || []; label = Account.Label || 'No label'; hasOne = items.length &amp;&amp; items.length &lt; 2;}}</w:t></w:r></w:p>
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>{{FOR item IN Account.Items}}</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>{{INS $item.Name}}</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>{{END-FOR item}}</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      <w:p><w:r><w:t>{{INS label}}</w:t></w:r></w:p>
    `);
    const zip = await JSZip.loadAsync(canonicalTemplate);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    zip.file(
      'word/document.xml',
      documentXml.replace('xmlns:w=', 'xmlns:ns0=').replace(/w:/g, 'ns0:')
    );
    const aliasedTemplate = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await mergeTemplate(
      aliasedTemplate,
      { Account: { Items: null, Label: null } },
      baseOptions
    );

    const mergedXml = await readDocxXml(result, 'word/document.xml');
    expect(mergedXml).toContain('xmlns:w=');
    expect(mergedXml).toContain('No label');
    expect(mergedXml).not.toContain('ns0:');
    expect(mergedXml).not.toContain('{{EXEC');
    expect(mergedXml).not.toContain('{{FOR');
    expect(mergedXml).not.toContain('<w:tbl');
  });

  it('preserves ordinary text containing the old literal XML delimiter', async () => {
    const template = await createTestDocxFromBodyXml(`
      <w:p><w:r><w:t>{{Account.Name}}</w:t></w:r></w:p>
    `);

    const result = await mergeTemplate(
      template,
      { Account: { Name: 'Left || Right' } },
      baseOptions
    );

    const documentXml = await readDocxXml(result, 'word/document.xml');
    expect(documentXml).toContain('Left || Right');
  });
});
