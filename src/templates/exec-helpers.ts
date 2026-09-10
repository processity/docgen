import { createCurrencyFormatter } from './locale-format';

type DataMap = Record<string, unknown>;

function isMap(value: unknown): value is DataMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Collect record-level currency without guessing from locale or child-row arrays. */
function collectCurrencies(data: DataMap): string[] {
  const direct = [data.CurrencyIsoCode, data.quoteCurrency]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim());
  if (direct.length > 0) return direct;

  const formats = data.__docgenFormats;
  if (isMap(formats)) {
    const described = Object.values(formats)
      .filter(isMap)
      .filter((format) => format.type === 'currency')
      .map((format) =>
        typeof format.currency === 'string' ? format.currency.trim() || 'USD' : 'USD'
      );
    if (described.length > 0) return described;
  }

  // Single-record object wrappers and Own Template composite namespaces.
  return Object.entries(data)
    .filter(([key, value]) => key !== '__docgenFormats' && isMap(value))
    .flatMap(([, value]) => collectCurrencies(value as DataMap));
}

export function createExecHelpers(data: DataMap, locale: string) {
  let formatCurrency: ReturnType<typeof createCurrencyFormatter> | undefined;
  let defaultCurrency: string | undefined;

  return {
    docgenFormatCurrency(value: unknown, currencyCode?: string | null): string {
      if (value === null || value === undefined || value === '') return '';
      let currency = currencyCode;
      if (currency == null || currency.trim() === '') {
        if (defaultCurrency === undefined) {
          const currencies = [...new Set(collectCurrencies(data))];
          if (currencies.length > 1) {
            throw new Error(
              'docgenFormatCurrency found multiple currencies. Pass the currency code as the second argument.'
            );
          }
          defaultCurrency = currencies[0] || 'USD';
        }
        currency = defaultCurrency;
      }
      formatCurrency ??= createCurrencyFormatter(locale);
      return formatCurrency(value, currency);
    },
  };
}
