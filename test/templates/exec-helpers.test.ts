import JSZip from 'jszip';
import { createExecHelpers } from '../../src/templates/exec-helpers';
import { formatDocumentData } from '../../src/templates/locale-format';
import { mergeTemplate } from '../../src/templates/merge';
import { createTestDocxWithContent } from '../helpers/test-docx';

describe('docgenFormatCurrency', () => {
  it.each([
    ['en-US', 'USD', '$1,234,567.89', '-$1,234,567.89'],
    ['en-GB', 'GBP', '£1,234,567.89', '-£1,234,567.89'],
    ['hi-IN', 'INR', '₹12,34,567.89', '-₹12,34,567.89'],
    ['ja-JP', 'JPY', '￥1,234,568', '-￥1,234,568'],
    ['fr-FR', 'EUR', '1\u202f234\u202f567,89\u00a0€', '-1\u202f234\u202f567,89\u00a0€'],
  ])('matches field formatting for %s / %s', (locale, currency, positive, negative) => {
    const data: Record<string, unknown> = {
      CurrencyIsoCode: currency,
      Amount: 1234567.89,
      __docgenFormats: { Amount: { type: 'currency', currency } },
    };
    formatDocumentData(data, locale, 'UTC');
    const helper = createExecHelpers(data, locale).docgenFormatCurrency;
    expect(helper(data.Amount)).toBe(positive);
    expect(helper(data.Amount)).toBe(data.Amount__formatted);
    expect(helper(-1234567.89)).toBe(negative);
    expect(data.Amount).toBe(1234567.89);
  });

  it('uses the request locale rather than the source record locale', () => {
    const helper = createExecHelpers(
      { SBQQ__Quote__c: { CurrencyIsoCode: 'INR', Quote_Offer_Locale__c: 'en-US' } },
      'hi-IN'
    ).docgenFormatCurrency;
    expect(helper(1234567.89)).toBe('₹12,34,567.89');
  });

  it('uses a custom provider quoteCurrency', () => {
    expect(createExecHelpers({ quoteCurrency: 'EUR' }, 'fr-FR').docgenFormatCurrency(1234.56)).toBe(
      '1\u202f234,56\u00a0€'
    );
  });

  it('uses currency descriptors when CurrencyIsoCode is absent', () => {
    const data = {
      Account: { __docgenFormats: { Revenue: { type: 'currency', currency: 'GBP' } } },
    };
    expect(createExecHelpers(data, 'en-GB').docgenFormatCurrency(12)).toBe('£12.00');
  });

  it('defaults to USD when currency is missing, without taking a child row currency', () => {
    const data = { rows: [{ CurrencyIsoCode: 'INR' }] };
    expect(createExecHelpers(data, 'en-GB').docgenFormatCurrency(12)).toBe('US$12.00');
  });

  it('requires an explicit code for mixed composite currencies', () => {
    const helper = createExecHelpers(
      { Quote: { CurrencyIsoCode: 'INR' }, Other: { CurrencyIsoCode: 'EUR' } },
      'hi-IN'
    ).docgenFormatCurrency;
    expect(() => helper(12)).toThrow('Pass the currency code');
    expect(helper(12, 'EUR')).toBe('€12.00');
  });

  it('allows a different currency per calculated subtotal', () => {
    const helper = createExecHelpers({ CurrencyIsoCode: 'INR' }, 'hi-IN').docgenFormatCurrency;
    expect(helper(12, 'EUR')).toBe('€12.00');
    expect(helper(12)).toBe('₹12.00');
  });

  it('preserves blanks and zero, and rejects nonnumeric display strings', () => {
    const helper = createExecHelpers({}, 'en-US').docgenFormatCurrency;
    expect(helper(null)).toBe('');
    expect(helper(undefined)).toBe('');
    expect(helper(0)).toBe('$0.00');
    expect(() => helper('1,234.56')).toThrow('Invalid number');
    expect(() => helper(Infinity)).toThrow('Invalid number');
    expect(() => helper(12, 'DOLLARS')).toThrow('Invalid currency');
  });

  it('formats an EXEC sum in an actual DOCX merge', async () => {
    const template = await createTestDocxWithContent(
      '{{EXEC total = SBQQ__Quote__c.rows.reduce((sum, line) => sum + line.Amount, 0); totalDisplay = docgenFormatCurrency(total); }}{{INS totalDisplay}}'
    );
    const data = {
      SBQQ__Quote__c: { CurrencyIsoCode: 'EUR', rows: [{ Amount: 1200 }, { Amount: 34.56 }] },
    };
    const result = await mergeTemplate(template, data, { locale: 'fr-FR', timezone: 'UTC' });
    const zip = await JSZip.loadAsync(result);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('1\u202f234,56\u00a0€');
  });

  it('isolates helper currency between concatenated section merges', async () => {
    const template = await createTestDocxWithContent('{{INS docgenFormatCurrency(1234.56)}}');
    const results = await Promise.all(
      ['GBP', 'EUR'].map((CurrencyIsoCode) =>
        mergeTemplate(template, { CurrencyIsoCode }, { locale: 'en-GB', timezone: 'UTC' })
      )
    );
    for (const [index, expected] of ['£1,234.56', '€1,234.56'].entries()) {
      const zip = await JSZip.loadAsync(results[index]);
      expect(await zip.file('word/document.xml')!.async('string')).toContain(expected);
    }
  });

  it('supports explicit currency in EXEC for an Own Template composite', async () => {
    const template = await createTestDocxWithContent(
      '{{EXEC amount = docgenFormatCurrency(-1835252.06, Quote.CurrencyIsoCode); }}{{INS amount}}'
    );
    const data = { Quote: { CurrencyIsoCode: 'INR' }, Other: { CurrencyIsoCode: 'EUR' } };
    const result = await mergeTemplate(template, data, { locale: 'hi-IN', timezone: 'UTC' });
    const zip = await JSZip.loadAsync(result);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('-₹18,35,252.06');
  });
});
