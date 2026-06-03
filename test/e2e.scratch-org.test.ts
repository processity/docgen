import { execFile } from 'child_process';
import { createRecord, getScratchOrgInfo } from '../e2e/utils/scratch-org';

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
}));

const mockedExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('E2E scratch org utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SF_INSTANCE_URL: 'https://scratch.example.my.salesforce.com/',
      SF_ACCESS_TOKEN: '00Dxx!token$with-special-chars',
      SF_USERNAME: 'test-user@example.com',
      SF_ORG_ID: '00Dxx0000000001',
    };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should prefer complete scratch org credentials from environment', async () => {
    const orgInfo = await getScratchOrgInfo();

    expect(orgInfo).toEqual({
      instanceUrl: 'https://scratch.example.my.salesforce.com',
      accessToken: '00Dxx!token$with-special-chars',
      username: 'test-user@example.com',
      orgId: '00Dxx0000000001',
    });
  });

  it('should create ContentVersion records through Salesforce CLI REST auth', async () => {
    mockedExecFile.mockImplementationOnce(((
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      callback(null, JSON.stringify({
        success: true,
        id: '068xx0000000001AAA',
      }), '');
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const recordId = await createRecord('ContentVersion', {
      Title: 'Template',
      PathOnClient: 'template.docx',
      VersionData: 'base64-content',
    });

    expect(recordId).toBe('068xx0000000001AAA');
    expect(mockedExecFile).toHaveBeenCalledWith(
      'sf',
      expect.arrayContaining([
        'api',
        'request',
        'rest',
        '/services/data/v65.0/sobjects/ContentVersion',
        '--method',
        'POST',
        '--target-org',
        'test-user@example.com',
      ]),
      expect.objectContaining({
        env: expect.not.objectContaining({
          SF_ACCESS_TOKEN: expect.any(String),
          SF_INSTANCE_URL: expect.any(String),
        }),
      }),
      expect.any(Function)
    );
  });
});
