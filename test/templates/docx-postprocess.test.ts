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
});
