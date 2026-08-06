import type { SalesforceApi } from '../../src/sf/api';
import { uploadPdfPreviewArtifacts } from '../../src/preview/artifacts';

function createApi() {
  return {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  } as unknown as SalesforceApi;
}

describe('uploadPdfPreviewArtifacts', () => {
  it('uploads ordered JPEG pages without linking them to a record', async () => {
    const api = createApi();
    const post = api.post as jest.Mock;
    const get = api.get as jest.Mock;
    post
      .mockResolvedValueOnce({ id: '068000000000001AAA', success: true })
      .mockResolvedValueOnce({ id: '068000000000002AAA', success: true });
    get
      .mockResolvedValueOnce({ records: [{ ContentDocumentId: '069000000000001AAA' }] })
      .mockResolvedValueOnce({ records: [{ ContentDocumentId: '069000000000002AAA' }] });

    const result = await uploadPdfPreviewArtifacts(
      [Buffer.from('page-one'), Buffer.from('page-two')],
      5,
      'aGT000000000001AAA',
      api,
      { correlationId: 'preview-test' }
    );

    expect(result).toEqual({
      contentVersionIds: ['068000000000001AAA', '068000000000002AAA'],
      contentDocumentIds: ['069000000000001AAA', '069000000000002AAA'],
      pageCount: 5,
    });
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/services/data/v59.0/sobjects/ContentVersion',
      expect.objectContaining({
        Title: 'DocGen-Preview-aGT000000000001AAA-Page-1',
        PathOnClient: 'DocGen-Preview-aGT000000000001AAA-Page-1.jpg',
        VersionData: Buffer.from('page-one').toString('base64'),
      }),
      { correlationId: 'preview-test' }
    );
    expect(post.mock.calls[0][1]).not.toHaveProperty('FirstPublishLocationId');
  });

  it('deletes pages already uploaded when a later upload fails', async () => {
    const api = createApi();
    const post = api.post as jest.Mock;
    const get = api.get as jest.Mock;
    const remove = api.delete as jest.Mock;
    post
      .mockResolvedValueOnce({ id: '068000000000001AAA', success: true })
      .mockRejectedValueOnce(new Error('upload failed'));
    get.mockResolvedValueOnce({ records: [{ ContentDocumentId: '069000000000001AAA' }] });
    remove.mockResolvedValue(undefined);

    await expect(
      uploadPdfPreviewArtifacts(
        [Buffer.from('page-one'), Buffer.from('page-two')],
        2,
        'aGT000000000001AAA',
        api
      )
    ).rejects.toThrow('upload failed');

    expect(remove).toHaveBeenCalledWith(
      '/services/data/v59.0/sobjects/ContentDocument/069000000000001AAA',
      undefined
    );
  });

  it('rejects inconsistent renderer metadata before uploading', async () => {
    const api = createApi();

    await expect(
      uploadPdfPreviewArtifacts(
        [Buffer.from('page-one'), Buffer.from('page-two')],
        1,
        'aGT000000000001AAA',
        api
      )
    ).rejects.toThrow('invalid page metadata');
    expect(api.post).not.toHaveBeenCalled();
  });
});
