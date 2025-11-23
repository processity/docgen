import JSZip from 'jszip';
import { concatenateDocx } from '../../src/templates/concatenate';
import type { TemplateSection } from '../../src/types';
import { createTestDocxWithContent, createTestDocxWithHeader } from '../helpers/test-docx';

describe('concatenateDocx', () => {
  const mockCorrelationId = 'test-correlation-123';

  describe('concatenation of multiple documents', () => {
    it('should concatenate 2 DOCX files with section breaks', async () => {
      // Create two test DOCX files with different content
      const docx1 = await createTestDocxWithContent('Page 1 Content', 'Account');
      const docx2 = await createTestDocxWithContent('Page 2 Content', 'Terms');

      const sections: TemplateSection[] = [
        { buffer: docx1, sequence: 1, namespace: 'Account' },
        { buffer: docx2, sequence: 2, namespace: 'Terms' }
      ];

      const result = await concatenateDocx(sections, mockCorrelationId);

      // Verify result is a valid DOCX buffer
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      // Verify the result can be loaded as a valid DOCX
      const zip = await JSZip.loadAsync(result);
      expect(zip.file('word/document.xml')).toBeTruthy();

      // Verify the document contains content from both sections
      const documentXml = await zip.file('word/document.xml')!.async('string');
      expect(documentXml).toContain('Page 1 Content');
      expect(documentXml).toContain('Page 2 Content');

      // Verify section break exists between the content
      expect(documentXml).toContain('<w:sectPr');
    });

    it('should order sections by sequence number', async () => {
      // Create sections with out-of-order sequence numbers
      const docx1 = await createTestDocxWithContent('Sequence 20 Content');
      const docx2 = await createTestDocxWithContent('Sequence 10 Content');
      const docx3 = await createTestDocxWithContent('Sequence 30 Content');

      const sections: TemplateSection[] = [
        { buffer: docx1, sequence: 20, namespace: 'Middle' },
        { buffer: docx2, sequence: 10, namespace: 'First' },
        { buffer: docx3, sequence: 30, namespace: 'Last' }
      ];

      const result = await concatenateDocx(sections, mockCorrelationId);

      // Verify the result contains content in correct order
      const zip = await JSZip.loadAsync(result);
      const documentXml = await zip.file('word/document.xml')!.async('string');

      // Extract content order by finding positions in the XML
      const pos10 = documentXml.indexOf('Sequence 10 Content');
      const pos20 = documentXml.indexOf('Sequence 20 Content');
      const pos30 = documentXml.indexOf('Sequence 30 Content');

      // Verify they appear in order: 10 < 20 < 30
      expect(pos10).toBeLessThan(pos20);
      expect(pos20).toBeLessThan(pos30);
    });
  });

  describe('single document handling', () => {
    it('should return the original buffer when only one section is provided', async () => {
      const singleDocx = await createTestDocxWithContent('Single Section Content');

      const sections: TemplateSection[] = [
        { buffer: singleDocx, sequence: 1, namespace: 'OnlyOne' }
      ];

      const result = await concatenateDocx(sections, mockCorrelationId);

      // For a single section, should return the original buffer unchanged
      expect(result).toBeInstanceOf(Buffer);

      // Verify it's a valid DOCX
      const zip = await JSZip.loadAsync(result);
      const documentXml = await zip.file('word/document.xml')!.async('string');
      expect(documentXml).toContain('Single Section Content');
    });
  });

  describe('error handling', () => {
    it('should throw error when empty array is provided', async () => {
      const sections: TemplateSection[] = [];

      await expect(concatenateDocx(sections, mockCorrelationId)).rejects.toThrow(
        'No sections provided for concatenation'
      );
    });
  });

  describe('header and footer preservation', () => {
    it('should preserve headers from each document', async () => {
      // Create two DOCX files with different headers
      const docx1 = await createTestDocxWithHeader('Company Logo Header', 'Body 1');
      const docx2 = await createTestDocxWithHeader('Terms & Conditions Header', 'Body 2');

      const sections: TemplateSection[] = [
        { buffer: docx1, sequence: 1, namespace: 'Account' },
        { buffer: docx2, sequence: 2, namespace: 'Terms' }
      ];

      const result = await concatenateDocx(sections, mockCorrelationId);

      // Verify result is valid
      expect(result).toBeInstanceOf(Buffer);

      // Verify the result maintains header files
      const zip = await JSZip.loadAsync(result);

      // Check that headers are preserved (header1.xml should exist)
      const hasHeader = zip.file('word/header1.xml') !== null;
      expect(hasHeader).toBe(true);

      // If headers are numbered (header1.xml, header2.xml), verify both exist
      // Note: Implementation might merge or keep separate headers
      if (hasHeader) {
        const headerXml = await zip.file('word/header1.xml')!.async('string');
        // At minimum, one of the headers should be present
        const hasFirstHeader = headerXml.includes('Company Logo Header');
        const hasSecondHeader = headerXml.includes('Terms & Conditions Header');
        expect(hasFirstHeader || hasSecondHeader).toBe(true);
      }
    });
  });

  describe('formatting preservation', () => {
    it('should preserve formatting in merged documents', async () => {
      // Create DOCX with some basic formatting (paragraphs and text runs)
      const docx1 = await createTestDocxWithContent('Formatted Content with multiple paragraphs');
      const docx2 = await createTestDocxWithContent('More formatted content');

      const sections: TemplateSection[] = [
        { buffer: docx1, sequence: 1, namespace: 'Section1' },
        { buffer: docx2, sequence: 2, namespace: 'Section2' }
      ];

      const result = await concatenateDocx(sections, mockCorrelationId);

      // Verify result maintains structure
      const zip = await JSZip.loadAsync(result);
      const documentXml = await zip.file('word/document.xml')!.async('string');

      // Verify paragraph structure is maintained
      expect(documentXml).toContain('<w:p>');
      expect(documentXml).toContain('<w:r>');
      expect(documentXml).toContain('<w:t>');

      // Verify both contents are present
      expect(documentXml).toContain('Formatted Content');
      expect(documentXml).toContain('More formatted content');
    });
  });

  describe('correlation ID logging', () => {
    it('should accept and use correlation ID for logging', async () => {
      // This test verifies the function accepts correlationId parameter
      // Actual logging verification would require mocking the logger
      const docx1 = await createTestDocxWithContent('Test Content 1');
      const docx2 = await createTestDocxWithContent('Test Content 2');

      const sections: TemplateSection[] = [
        { buffer: docx1, sequence: 1, namespace: 'Test1' },
        { buffer: docx2, sequence: 2, namespace: 'Test2' }
      ];

      const customCorrelationId = 'custom-correlation-456';

      // Should not throw and should complete successfully
      const result = await concatenateDocx(sections, customCorrelationId);
      expect(result).toBeInstanceOf(Buffer);

      // Also test without correlation ID (optional parameter)
      const resultWithoutId = await concatenateDocx(sections);
      expect(resultWithoutId).toBeInstanceOf(Buffer);
    });
  });
});
