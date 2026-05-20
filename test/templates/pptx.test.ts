import JSZip from 'jszip';
import { mergePptxTemplate } from '../../src/templates/pptx';
import { createTestPptxBuffer } from '../helpers/test-pptx';

describe('PPTX template merge', () => {
  it('replaces scalar placeholders in slide XML', async () => {
    const template = await createTestPptxBuffer();

    const result = await mergePptxTemplate(
      template,
      { Account: { Name: 'Acme & Co' } },
      { locale: 'en-GB', timezone: 'Europe/London' }
    );

    const zip = await JSZip.loadAsync(result);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(slideXml).toContain('Acme &amp; Co');
    expect(slideXml).not.toContain('{{Account.Name}}');
  });
});
