const { buildSfdxAuthUrl, normalizeInstanceUrl } = require('../../scripts/extract-sfdx-auth-url');

describe('extract-sfdx-auth-url', () => {
  it('uses display sfdxAuthUrl when available', () => {
    const authUrl = 'force://PlatformCLI::refresh@test.salesforce.com';

    expect(buildSfdxAuthUrl({
      createResult: { result: {} },
      displayResult: { result: { sfdxAuthUrl: authUrl } },
    })).toBe(authUrl);
  });

  it('builds force URL from scratch org create authFields', () => {
    const refreshToken = 'tok@en:segment';

    expect(buildSfdxAuthUrl({
      createResult: {
        result: {
          authFields: {
            clientId: 'PlatformCLI',
            refreshToken,
            instanceUrl: 'https://scratch.example.my.salesforce.com/',
          },
        },
      },
      displayResult: { result: { sfdxAuthUrl: 'undefined' } },
    })).toBe(`force://PlatformCLI::${refreshToken}@scratch.example.my.salesforce.com`);
  });

  it('throws when refresh token is unavailable', () => {
    expect(() => buildSfdxAuthUrl({
      createResult: { result: { authFields: { clientId: 'PlatformCLI' } } },
      displayResult: { result: { instanceUrl: 'https://scratch.example.my.salesforce.com' } },
    })).toThrow(/missing clientId, refreshToken, or instanceUrl/i);
  });

  it('normalizes instance URL protocol and trailing slash', () => {
    expect(normalizeInstanceUrl('https://scratch.example.my.salesforce.com/'))
      .toBe('scratch.example.my.salesforce.com');
  });
});
