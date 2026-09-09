import { formatDocumentData } from '../../src/templates/locale-format';

type TestRecord = Record<string, unknown> & {
  Amount: number | null;
  __docgenFormats: Record<string, { type: string; currency?: string; scale?: number }>;
};

function record(currency = 'USD'): TestRecord {
  return {
    Amount: 1234567.89,
    CloseDate: '2026-09-09',
    CreatedDate: '2026-09-09T00:30:00.000Z',
    Probability: 12.5,
    Quantity: 1234.567,
    __docgenFormats: {
      Amount: { type: 'currency', currency },
      CloseDate: { type: 'date' },
      CreatedDate: { type: 'datetime' },
      Probability: { type: 'percent', scale: 1 },
      Quantity: { type: 'number', scale: 3 },
    },
  };
}

describe('document locale formatting', () => {
  it.each([
    'en-US',
    'en-GB',
    'de-DE',
    'fr-FR',
    'hi-IN',
    'ja-JP',
    'ar-EG',
    'pt-BR',
    'th-TH',
    'zh-CN',
    'sv-SE',
  ])(
    'formats currency, dates and percentage points for %s without converting amounts',
    (locale) => {
      const data = record();
      formatDocumentData(data, locale, 'UTC');
      expect(data.Amount).toBe(1234567.89);
      expect(data.Amount__formatted).toBe(
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(data.Amount!)
      );
      expect(data.CloseDate__formatted).toBe(
        new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
          new Date('2026-09-09T00:00:00Z')
        )
      );
      expect(data.Probability__formatted).toBe(
        new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(0.125)
      );
      expect(data.Quantity__formatted).toBe(
        new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(1234.567)
      );
    }
  );

  it('keeps USD in a German locale with German separators and trailing symbol', () => {
    const data = record();
    formatDocumentData(data, 'de_DE', 'UTC');
    expect(data.Amount__formatted).toBe('1.234.567,89\u00a0$');
  });

  it('uses Indian digit grouping and French narrow spaces', () => {
    const india = record('INR');
    const france = record('EUR');
    formatDocumentData(india, 'hi-IN', 'UTC');
    formatDocumentData(france, 'fr-FR', 'UTC');
    expect(india.Amount__formatted).toBe('₹12,34,567.89');
    expect(france.Amount__formatted).toBe('1\u202f234\u202f567,89\u00a0€');
  });

  it('uses currency-specific decimal precision', () => {
    const yen = record('JPY');
    const dinar = record('KWD');
    formatDocumentData(yen, 'en-US', 'UTC');
    formatDocumentData(dinar, 'en-US', 'UTC');
    expect(yen.Amount__formatted).toBe('¥1,234,568');
    expect(dinar.Amount__formatted).toContain('1,234,567.890');
  });

  it('shifts DateTime but never shifts Date-only fields', () => {
    const data = record();
    formatDocumentData(data, 'en-US', 'America/Los_Angeles');
    expect(data.CloseDate__formatted).toBe('Sep 9, 2026');
    expect(data.CreatedDate__formatted).toContain('Sep 8, 2026');
  });

  it('walks composite sections and nested rows, preserves untyped custom display strings', () => {
    const data = {
      Quote: { records: [record()] },
      Custom: { Amount: 10, Amount__formatted: 'Custom display' },
    };
    formatDocumentData(data, 'de-DE', 'UTC');
    expect(data.Quote.records[0].Amount__formatted).toBe('1.234.567,89\u00a0$');
    expect(data.Custom.Amount__formatted).toBe('Custom display');
  });

  it.each(['not_a_locale_!', 'zz-ZZ'])('rejects invalid or unavailable locale %s', (locale) => {
    expect(() => formatDocumentData(record(), locale, 'UTC')).toThrow('Unable to format document');
  });

  it('requires record currency instead of guessing from locale', () => {
    const data = record();
    delete data.__docgenFormats.Amount.currency;
    expect(() => formatDocumentData(data, 'en-GB', 'UTC')).toThrow('Include CurrencyIsoCode');
  });

  it('keeps null currency blank without requiring a code', () => {
    const data = record();
    data.Amount = null;
    delete data.__docgenFormats.Amount.currency;
    formatDocumentData(data, 'en-US', 'UTC');
    expect(data.Amount__formatted).toBe('');
  });
});
