import { mergeTemplate, validateMergeData, extractImageUrls } from '../../src/templates/merge';
import type { MergeOptions } from '../../src/types';

// Mock docx-templates
jest.mock('docx-templates', () => {
  return jest.fn().mockImplementation(() => {
    // Simple mock that returns a buffer
    return Promise.resolve(Buffer.from('merged document content'));
  });
});

describe('Template Merge', () => {
  describe('mergeTemplate', () => {
    const mockTemplate = Buffer.from('mock template');
    const mockOptions: MergeOptions = {
      locale: 'en-GB',
      timezone: 'Europe/London',
      imageAllowlist: ['cdn.example.com', 'images.company.com'],
    };

    it('should merge template with data successfully', async () => {
      const data = {
        Account: {
          Name: 'Acme Ltd',
          AnnualRevenue__formatted: '£1,200,000',
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle nested Salesforce field paths', async () => {
      const data = {
        Opportunity: {
          Name: 'FY25 Renewal',
          Owner: {
            Name: 'John Smith',
            Email: 'john@example.com',
          },
          Amount__formatted: '£250,000',
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle arrays for loops', async () => {
      const data = {
        Opportunity: {
          Name: 'FY25 Renewal',
          LineItems: [
            {
              Name: 'SKU-A',
              Quantity: 10,
              UnitPrice__formatted: '£1,000',
              TotalPrice__formatted: '£10,000',
            },
            {
              Name: 'SKU-B',
              Quantity: 5,
              UnitPrice__formatted: '£2,000',
              TotalPrice__formatted: '£10,000',
            },
          ],
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle empty arrays', async () => {
      const data = {
        Opportunity: {
          Name: 'Test',
          LineItems: [],
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle null values in data', async () => {
      const data = {
        Account: {
          Name: 'Test Account',
          ParentId: null,
          Description: null,
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle boolean fields', async () => {
      const data = {
        Account: {
          Name: 'Partner Corp',
          IsPartner: true,
          IsActive: false,
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle formatted currency/date/number fields', async () => {
      const data = {
        Opportunity: {
          Amount__formatted: '£250,000.00',
          CloseDate__formatted: '31 December 2025',
          Probability__formatted: '75%',
          CreatedDate__formatted: '01 Jan 2025 10:30 GMT',
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should work with minimal options', async () => {
      const minimalOptions: MergeOptions = {
        locale: 'en-US',
        timezone: 'America/New_York',
      };

      const data = { Account: { Name: 'Test' } };

      const result = await mergeTemplate(mockTemplate, data, minimalOptions);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle complex nested structures', async () => {
      const data = {
        Account: {
          Name: 'Acme Ltd',
          Contacts: [
            {
              FirstName: 'John',
              LastName: 'Doe',
              Email: 'john@acme.com',
              Phone: '+44 20 1234 5678',
            },
            {
              FirstName: 'Jane',
              LastName: 'Smith',
              Email: 'jane@acme.com',
              Phone: '+44 20 8765 4321',
            },
          ],
          Opportunities: [
            {
              Name: 'Deal 1',
              Amount__formatted: '£100,000',
              Stage: 'Closed Won',
            },
          ],
        },
      };

      const result = await mergeTemplate(mockTemplate, data, mockOptions);

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('validateMergeData', () => {
    it('should return no warnings for valid data', () => {
      const data = {
        Account: {
          Name: 'Test Account',
          Revenue: 1000000,
        },
      };

      const warnings = validateMergeData(data);

      expect(warnings).toEqual([]);
    });

    it('should warn about empty data object', () => {
      const data = {};

      const warnings = validateMergeData(data);

      expect(warnings).toContain('Data object is empty');
    });

    it('should warn about undefined values', () => {
      const data = {
        Account: {
          Name: 'Test',
          Description: undefined,
        },
      };

      const warnings = validateMergeData(data);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('undefined');
      expect(warnings[0]).toContain('Account.Description');
    });

    it('should accept null values without warning', () => {
      const data = {
        Account: {
          Name: 'Test',
          Description: null,
          ParentId: null,
        },
      };

      const warnings = validateMergeData(data);

      expect(warnings).toEqual([]);
    });

    it('should detect undefined in nested objects', () => {
      const data = {
        Opportunity: {
          Name: 'Test',
          Owner: {
            Name: 'John',
            Email: undefined,
          },
        },
      };

      const warnings = validateMergeData(data);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Opportunity.Owner.Email');
    });

    it('should handle arrays without warnings', () => {
      const data = {
        Opportunity: {
          LineItems: [
            { Name: 'Item 1', Quantity: 10 },
            { Name: 'Item 2', Quantity: 5 },
          ],
        },
      };

      const warnings = validateMergeData(data);

      expect(warnings).toEqual([]);
    });
  });

  describe('extractImageUrls', () => {
    it('should extract HTTP/HTTPS URLs that look like images', () => {
      const data = {
        Account: {
          Name: 'Test',
          LogoUrl: 'https://cdn.example.com/logo.png',
          BannerUrl: 'https://images.company.com/banner.jpg',
        },
      };

      const urls = extractImageUrls(data);

      expect(urls).toContain('https://cdn.example.com/logo.png');
      expect(urls).toContain('https://images.company.com/banner.jpg');
      expect(urls.length).toBe(2);
    });

    it('should extract URLs with image extensions', () => {
      const data = {
        Images: {
          PNG: 'https://example.com/image.png',
          JPG: 'https://example.com/photo.jpg',
          JPEG: 'https://example.com/pic.jpeg',
          GIF: 'https://example.com/animation.gif',
          SVG: 'https://example.com/vector.svg',
          WebP: 'https://example.com/modern.webp',
        },
      };

      const urls = extractImageUrls(data);

      expect(urls.length).toBe(6);
    });

    it('should extract URLs containing /image/ path', () => {
      const data = {
        Account: {
          Logo: 'https://api.example.com/image/abc123',
        },
      };

      const urls = extractImageUrls(data);

      expect(urls).toContain('https://api.example.com/image/abc123');
    });

    it('should not extract non-image URLs', () => {
      const data = {
        Account: {
          Website: 'https://example.com',
          DocumentUrl: 'https://example.com/doc.pdf',
          ApiEndpoint: 'https://api.example.com/data',
        },
      };

      const urls = extractImageUrls(data);

      expect(urls).toEqual([]);
    });

    it('should extract from nested objects', () => {
      const data = {
        Account: {
          Name: 'Test',
          Branding: {
            Logo: 'https://cdn.example.com/logo.png',
            Banner: 'https://cdn.example.com/banner.jpg',
          },
        },
      };

      const urls = extractImageUrls(data);

      expect(urls.length).toBe(2);
      expect(urls).toContain('https://cdn.example.com/logo.png');
      expect(urls).toContain('https://cdn.example.com/banner.jpg');
    });

    it('should extract from arrays', () => {
      const data = {
        Products: [
          { Name: 'Product 1', Image: 'https://cdn.example.com/product1.png' },
          { Name: 'Product 2', Image: 'https://cdn.example.com/product2.png' },
        ],
      };

      const urls = extractImageUrls(data);

      expect(urls.length).toBe(2);
    });

    it('should not extract base64 images', () => {
      const data = {
        Account: {
          Logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      };

      const urls = extractImageUrls(data);

      expect(urls).toEqual([]);
    });

    it('should return empty array for data without images', () => {
      const data = {
        Account: {
          Name: 'Test Account',
          Revenue: 1000000,
          City: 'London',
        },
      };

      const urls = extractImageUrls(data);

      expect(urls).toEqual([]);
    });

    it('should handle empty data object', () => {
      const urls = extractImageUrls({});

      expect(urls).toEqual([]);
    });
  });
});
