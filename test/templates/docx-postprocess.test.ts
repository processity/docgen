import JSZip from 'jszip';
import { mergeTemplate } from '../../src/templates/merge';
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
    expect(headerXml).toContain('<w10:wrap anchorx="margin" anchory="margin"/>');
    expect(headerXml).toContain('string="DRAFT"');
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
