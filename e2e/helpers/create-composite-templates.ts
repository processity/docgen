import JSZip from 'jszip';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper to create DOCX template files with merge fields for composite document testing.
 * Uses JSZip to programmatically generate valid DOCX files.
 */

/**
 * Creates a composite template that uses all namespaces (for Own Template strategy)
 * Uses consistent records array structure with FOR loops for all namespaces
 */
export async function createCompositeAccountSummaryTemplate(): Promise<Buffer> {
  const zip = new JSZip();

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

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>ACCOUNT SUMMARY REPORT</w:t></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Account Information</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR account IN Account.records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Account Name: {{$account.Name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Type: {{$account.Type}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Industry: {{$account.Industry}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Annual Revenue: {{$account.AnnualRevenue__formatted}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Employees: {{$account.NumberOfEmployees}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Phone: {{$account.Phone}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Website: {{$account.Website}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Owner: {{$account.Owner.Name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR account}}</w:t></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Contacts</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR contact IN Contacts.records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>• {{$contact.Name}}{{IF $contact.Title}} - {{$contact.Title}}{{END-IF}}{{IF $contact.Email}} ({{$contact.Email}}){{END-IF}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR contact}}</w:t></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Opportunities</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR opp IN Opportunities.records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>• {{$opp.Name}} ({{$opp.StageName}}) - {{$opp.Amount__formatted}} - Close: {{$opp.CloseDate__formatted}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR opp}}</w:t></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Support Cases</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR c IN Cases.records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>• {{$c.Subject}} ({{$c.Status}}) - Priority: {{$c.Priority}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR c}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

/**
 * Creates Account section template (for Concatenate strategy)
 * Uses MultiRecordSOQLProvider with records array for consistency
 */
export async function createAccountBasicsSectionTemplate(): Promise<Buffer> {
  const zip = new JSZip();

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

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>ACCOUNT INFORMATION</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR account IN records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Account Name: {{$account.Name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Type: {{$account.Type}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Industry: {{$account.Industry}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Annual Revenue: {{$account.AnnualRevenue__formatted}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Employees: {{$account.NumberOfEmployees}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Phone: {{$account.Phone}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Website: {{$account.Website}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Owner: {{$account.Owner.Name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Description: {{$account.Description}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR account}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

/**
 * Creates Contacts section template (for Concatenate strategy)
 * Note: For concatenate strategy, the template receives the SOQL result array directly
 * so we iterate over the records array
 */
export async function createContactsSectionTemplate(): Promise<Buffer> {
  const zip = new JSZip();

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

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>CONTACTS</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR contact IN records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>• {{$contact.Name}}{{IF $contact.Title}} - {{$contact.Title}}{{END-IF}}{{IF $contact.Email}} ({{$contact.Email}}){{END-IF}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR contact}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

/**
 * Creates Opportunities section template (for Concatenate strategy)
 */
export async function createOpportunitiesSectionTemplate(): Promise<Buffer> {
  const zip = new JSZip();

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

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>OPPORTUNITIES</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR opp IN records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>• {{$opp.Name}} ({{$opp.StageName}}) - {{$opp.Amount__formatted}} - Close: {{$opp.CloseDate__formatted}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR opp}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

/**
 * Creates Cases section template (for Concatenate strategy)
 */
export async function createCasesSectionTemplate(): Promise<Buffer> {
  const zip = new JSZip();

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

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>SUPPORT CASES</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{FOR c IN records}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>• {{$c.Subject}} ({{$c.Status}}) - Priority: {{$c.Priority}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{END-FOR c}}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

/**
 * Generates all template files and writes them to the fixtures directory
 */
export async function generateAllCompositeTemplates(): Promise<void> {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');

  // Ensure fixtures directory exists
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  // Generate and write all templates
  const templates = [
    { name: 'composite-account-summary.docx', generator: createCompositeAccountSummaryTemplate },
    { name: 'account-basics-section.docx', generator: createAccountBasicsSectionTemplate },
    { name: 'contacts-section.docx', generator: createContactsSectionTemplate },
    { name: 'opportunities-section.docx', generator: createOpportunitiesSectionTemplate },
    { name: 'cases-section.docx', generator: createCasesSectionTemplate }
  ];

  for (const template of templates) {
    const buffer = await template.generator();
    const filePath = path.join(fixturesDir, template.name);
    fs.writeFileSync(filePath, buffer);
    console.log(`Created: ${template.name}`);
  }
}

// Run if executed directly
if (require.main === module) {
  generateAllCompositeTemplates()
    .then(() => console.log('All composite templates created successfully'))
    .catch(err => console.error('Error creating templates:', err));
}
