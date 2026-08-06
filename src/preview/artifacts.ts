import type { CorrelationOptions } from '../types';
import type { SalesforceApi } from '../sf/api';
import { deleteContentDocuments, uploadContentVersion } from '../sf/files';

export interface PdfPreviewArtifacts {
  contentVersionIds: string[];
  contentDocumentIds: string[];
  pageCount: number;
}

export async function uploadPdfPreviewArtifacts(
  imagePages: readonly Buffer[],
  pageCount: number,
  generatedDocumentId: string,
  api: SalesforceApi,
  options?: CorrelationOptions
): Promise<PdfPreviewArtifacts> {
  if (imagePages.length === 0 || pageCount < imagePages.length) {
    throw new Error('PDF preview renderer returned invalid page metadata');
  }

  const contentVersionIds: string[] = [];
  const contentDocumentIds: string[] = [];

  try {
    for (let index = 0; index < imagePages.length; index += 1) {
      const pageNumber = index + 1;
      const upload = await uploadContentVersion(
        imagePages[index],
        `DocGen-Preview-${generatedDocumentId}-Page-${pageNumber}.jpg`,
        api,
        options
      );
      contentVersionIds.push(upload.contentVersionId);
      contentDocumentIds.push(upload.contentDocumentId);
    }
  } catch (error) {
    await deleteContentDocuments(contentDocumentIds, api, options).catch(() => undefined);
    throw error;
  }

  return {
    contentVersionIds,
    contentDocumentIds,
    pageCount,
  };
}
