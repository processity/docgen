import { formatAndStoreRequest, requestJsonFields } from '../src/sf/formatted-request';
import type { SalesforceApi } from '../src/sf/api';
import type { DocgenRequest } from '../src/types';

function request(): DocgenRequest {
  return {
    templateId: '068000000000001AAA',
    outputFileName: 'quote.pdf',
    outputFormat: 'PDF',
    locale: 'hi-IN',
    timezone: 'UTC',
    options: { storeMergedDocx: false, returnDocxToBrowser: false },
    requestHash: 'sha256:original',
    data: {
      Quote: {
        Amount: -1835252.06,
        Amount__formatted: '$-1,835,252.06',
        __docgenFormats: { Amount: { type: 'currency', currency: 'INR' } },
      },
    },
  };
}

describe('formatted request persistence', () => {
  const patch = jest.fn();
  const api = { patch } as unknown as SalesforceApi;
  beforeEach(() => patch.mockReset());

  it('stores the same localized values passed to the renderer and preserves request identity', async () => {
    const input = request();
    await formatAndStoreRequest(input, 'a00000000000001AAA', api);
    const [url, fields] = patch.mock.calls[0];
    expect(url).toContain('/Generated_Document__c/a00000000000001AAA');
    const stored = JSON.parse(fields.RequestJSON__c);
    expect(stored).toEqual(input);
    expect(stored.data.Quote.Amount__formatted).toBe('-₹18,35,252.06');
    expect(stored.data.Quote.Amount).toBe(-1835252.06);
    expect(stored.requestHash).toBe('sha256:original');
    expect(fields.RequestJSON02__c).toBeNull();
    expect(fields.RequestJSON10__c).toBeNull();
    expect(fields).not.toHaveProperty('RequestHash__c');
  });

  it('does not rewrite a request already formatted by an earlier attempt', async () => {
    const input = request();
    await formatAndStoreRequest(input, 'a00000000000001AAA', api);
    patch.mockClear();
    await formatAndStoreRequest(input, 'a00000000000001AAA', api);
    expect(patch).not.toHaveBeenCalled();
  });

  it('still formats API requests without a Salesforce tracking record', async () => {
    const input = request();
    await formatAndStoreRequest(input, undefined, api);
    expect(input.data.Quote.Amount__formatted).toBe('-₹18,35,252.06');
    expect(patch).not.toHaveBeenCalled();
  });

  it('stops rendering when saving the corrected request fails', async () => {
    patch.mockRejectedValueOnce(new Error('Salesforce unavailable'));
    await expect(formatAndStoreRequest(request(), 'a00000000000001AAA', api)).rejects.toThrow(
      'Salesforce unavailable'
    );
  });

  it('reconstructs large requests without splitting Unicode characters', () => {
    const text = 'a'.repeat(131071) + '😀' + 'b'.repeat(131072);
    const fields = requestJsonFields(text);
    expect(Object.values(fields).filter(Boolean).join('')).toBe(text);
    expect(fields.RequestJSON__c?.length).toBe(131071);
    expect(fields.RequestJSON02__c?.startsWith('😀')).toBe(true);
    expect(Object.values(fields).every((value) => value === null || value.length <= 131072)).toBe(
      true
    );
  });

  it('fails rather than silently truncating an oversized request', () => {
    expect(() => requestJsonFields('x'.repeat(1310720 + 1))).toThrow('segmented storage capacity');
  });
});
