import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

describe('Documentation', () => {
  describe('README.md', () => {
    it('should exist', () => {
      const readmePath = path.join(__dirname, '..', 'README.md');
      expect(fs.existsSync(readmePath)).toBe(true);
    });

    it('should contain Mermaid sequence diagram', () => {
      const readmePath = path.join(__dirname, '..', 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf8');

      expect(readmeContent).toContain('```mermaid');
      expect(readmeContent).toContain('sequenceDiagram');
      expect(readmeContent).toContain('Interactive Generation Flow');
      expect(readmeContent).toContain('Batch Generation Flow');
    });
  });

  describe('ADRs (Architecture Decision Records)', () => {
    const adrDir = path.join(__dirname, '..', 'docs', 'adr');

    it('should have ADR directory', () => {
      expect(fs.existsSync(adrDir)).toBe(true);
      expect(fs.statSync(adrDir).isDirectory()).toBe(true);
    });

    const requiredAdrs = [
      { file: '0001-runtime.md', title: 'runtime' },
      { file: '0002-auth.md', title: 'auth' },
      { file: '0003-worker.md', title: 'worker' },
      { file: '0004-caching.md', title: 'caching' }
    ];

    requiredAdrs.forEach(({ file, title }) => {
      describe(file, () => {
        const adrPath = path.join(adrDir, file);

        it('should exist', () => {
          expect(fs.existsSync(adrPath)).toBe(true);
        });

        it('should contain required ADR sections', () => {
          const content = fs.readFileSync(adrPath, 'utf8');

          // Check for standard ADR sections
          expect(content).toMatch(/^#\s+ADR[-\s]/im); // Title
          expect(content).toMatch(/\*\*Status\*\*:/i); // Status section (bold)
          expect(content).toMatch(/^##\s+Context/im); // Context section
          expect(content).toMatch(/^##\s+Decision/im); // Decision section
        });

        it(`should be related to ${title}`, () => {
          const content = fs.readFileSync(adrPath, 'utf8');
          expect(content.toLowerCase()).toContain(title);
        });
      });
    });

    it('should have exactly 4 ADRs from T-01 and T-02', () => {
      const adrFiles = fs.readdirSync(adrDir)
        .filter(f => f.endsWith('.md') && /^\d{4}-.+\.md$/.test(f));

      expect(adrFiles).toHaveLength(4);
    });
  });
});
