import type { DocgenRequest, CorrelationOptions } from '../types';
import type { SalesforceApi } from './api';
import { ValidationError } from '../errors';
import { formatDocumentData } from '../templates/locale-format';

const SEGMENT_LENGTH = 131072;
const SEGMENT_COUNT = 10;

/** Match Apex's request storage and clear any segments left over from a longer request. */
export function requestJsonFields(json: string): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  let offset = 0;
  for (let index = 0; index < SEGMENT_COUNT; index++) {
    const name =
      index === 0 ? 'RequestJSON__c' : `RequestJSON${String(index + 1).padStart(2, '0')}__c`;
    let end = Math.min(offset + SEGMENT_LENGTH, json.length);
    // Never put half of a Unicode surrogate pair into a Salesforce text field.
    if (end < json.length && /[\uD800-\uDBFF]/.test(json.charAt(end - 1))) end--;
    fields[name] = offset < json.length ? json.slice(offset, end) : null;
    offset = end;
  }
  if (offset < json.length)
    throw new ValidationError('Formatted Request JSON exceeds segmented storage capacity');
  return fields;
}

/** Persist the exact localized data consumed by the renderer, before rendering starts. */
export async function formatAndStoreRequest(
  request: DocgenRequest,
  documentId: string | undefined,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<void> {
  const before = JSON.stringify(request);
  formatDocumentData(request.data, request.locale, request.timezone);
  const formatted = JSON.stringify(request);
  if (documentId && formatted !== before) {
    await api.patch(
      `/services/data/v59.0/sobjects/Generated_Document__c/${documentId}`,
      requestJsonFields(formatted),
      options
    );
  }
}
