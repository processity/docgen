import axios from 'axios';
import { createRecord, getScratchOrgInfo } from '../e2e/utils/scratch-org';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

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

  it('should create ContentVersion records through Axios without shelling the token', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        success: true,
        id: '068xx0000000001AAA',
      },
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {
        url: 'https://scratch.example.my.salesforce.com/services/data/v65.0/sobjects/ContentVersion',
      },
    });

    const recordId = await createRecord('ContentVersion', {
      Title: 'Template',
      PathOnClient: 'template.docx',
      VersionData: 'base64-content',
    });

    expect(recordId).toBe('068xx0000000001AAA');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://scratch.example.my.salesforce.com/services/data/v65.0/sobjects/ContentVersion',
      {
        Title: 'Template',
        PathOnClient: 'template.docx',
        VersionData: 'base64-content',
      },
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer 00Dxx!token$with-special-chars',
          'Content-Type': 'application/json',
        },
      })
    );
  });
});
