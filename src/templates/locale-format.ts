import { TemplateMergeError } from '../errors';

const FORMAT_KEY = '__docgenFormats';
type DataMap = Record<string, unknown>;

function isMap(value: unknown): value is DataMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Localize typed Salesforce values once, before any output-format or composite branching. */
export function formatDocumentData(data: DataMap, locale: string, timezone: string): void {
  try {
    const canonical = Intl.getCanonicalLocales((locale || 'en-US').trim().replace(/_/g, '-'))[0];
    if (
      !canonical ||
      Intl.NumberFormat.supportedLocalesOf([canonical]).length === 0 ||
      Intl.DateTimeFormat.supportedLocalesOf([canonical]).length === 0
    ) {
      throw new Error(`Unsupported document locale: ${locale}`);
    }
    const date = new Intl.DateTimeFormat(canonical, { dateStyle: 'medium', timeZone: 'UTC' });
    const datetime = new Intl.DateTimeFormat(canonical, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'UTC',
    });
    const numbers = new Map<string, Intl.NumberFormat>();

    const display = (value: unknown, format: DataMap, path: string): string => {
      if (value === null || value === undefined || value === '') return '';
      if (format.type === 'date' || format.type === 'datetime') {
        if (typeof value !== 'string') throw new Error(`Expected a date string at ${path}`);
        // Date-only values represent calendar dates, never timezone-shifted instants.
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
        if (format.type === 'date' && !dateOnly) throw new Error(`Invalid date at ${path}`);
        if (format.type === 'datetime' && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
          throw new Error(`DateTime must include a timezone at ${path}`);
        }
        const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
        if (
          !Number.isFinite(parsed.getTime()) ||
          (dateOnly && parsed.toISOString().slice(0, 10) !== value)
        ) {
          throw new Error(`Invalid date at ${path}`);
        }
        return (format.type === 'date' ? date : datetime).format(parsed);
      }
      if (!['number', 'currency', 'percent'].includes(String(format.type))) {
        throw new Error(`Unknown formatting type at ${path}`);
      }
      if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        !Number.isFinite(Number(value))
      ) {
        throw new Error(`Invalid number at ${path}`);
      }
      const options: Intl.NumberFormatOptions = {};
      if (format.type === 'currency') {
        const currency =
          typeof format.currency === 'string'
            ? format.currency.trim() || 'USD'
            : (format.currency ?? 'USD');
        if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
          throw new Error(
            `Invalid currency at ${path}: expected a three-letter ISO currency code.`
          );
        }
        options.style = 'currency';
        options.currency = currency;
      } else {
        options.style = format.type === 'percent' ? 'percent' : 'decimal';
        options.maximumFractionDigits = typeof format.scale === 'number' ? format.scale : 2;
      }
      const key = JSON.stringify(options);
      let formatter = numbers.get(key);
      if (!formatter) {
        formatter = new Intl.NumberFormat(canonical, options);
        numbers.set(key, formatter);
      }
      // Salesforce percentages are percentage points (75 means 75%, not 7500%).
      return formatter.format(format.type === 'percent' ? Number(value) / 100 : Number(value));
    };

    const visit = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${path}[${index}]`));
      } else if (isMap(value)) {
        const formats = value[FORMAT_KEY];
        if (isMap(formats)) {
          for (const [field, format] of Object.entries(formats)) {
            if (Object.prototype.hasOwnProperty.call(value, field) && isMap(format)) {
              value[`${field}__formatted`] = display(value[field], format, `${path}.${field}`);
            }
          }
        }
        for (const [field, child] of Object.entries(value)) {
          if (field !== FORMAT_KEY) visit(child, `${path}.${field}`);
        }
      }
    };
    visit(data, 'data');
  } catch (error) {
    throw new TemplateMergeError(
      `Unable to format document for locale "${locale}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
