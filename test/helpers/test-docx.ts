import JSZip from 'jszip';

/**
 * Creates a minimal valid DOCX buffer for testing using JSZip.
 * This DOCX file contains proper ZIP structure that docx-templates can parse.
 *
 * The template contains only the GeneratedDate__formatted field which is
 * present in all test payloads.
 */
export async function createTestDocxBuffer(): Promise<Buffer> {
  const zip = new JSZip();

  // [Content_Types].xml - defines the file types in the package
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  // _rels/.rels - package relationships
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  // word/document.xml - the main document with template placeholders
  // Minimal template with only the common GeneratedDate__formatted field
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>Test Template Document</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>Generated Date: {{GeneratedDate__formatted}}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

  // Add files to the ZIP
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);

  // Generate the DOCX buffer
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return buffer;
}

/**
 * Creates a test DOCX buffer that should fail merge due to bad template syntax.
 * Contains an unclosed template tag: {{Name (missing closing braces)
 */
export async function createBadTestDocxBuffer(): Promise<Buffer> {
  const zip = new JSZip();

  // Same structure as valid DOCX
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  // Invalid template with unclosed tag
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>Bad Template - This has an unclosed tag: {{Name</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return buffer;
}