export const DEFAULT_MAX_PREVIEW_PAGES = 20;
export const HARD_MAX_PREVIEW_PAGES = 20;
export const MAX_PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024;

export interface PdfPagePreviewRequest {
  generatedDocumentId: string;
  requestingUserId: string;
  pageNumber: number;
  maxPreviewPages?: number;
}

export interface PdfPagePreviewResponse {
  contentType: 'image/jpeg';
  base64Data: string;
  pageNumber: number;
  pageCount: number;
  previewPageCount: number;
  previewTruncated: boolean;
}

export interface GeneratedDocumentPreviewRecord {
  Id: string;
  Status__c: string | null;
  PendingPreview__c: boolean;
  OutputFormat__c: string | null;
  RequestedBy__c: string | null;
  OutputFileId__c: string | null;
}

export interface PdfPageRenderResult {
  imageData: Buffer;
  pageCount: number;
}
