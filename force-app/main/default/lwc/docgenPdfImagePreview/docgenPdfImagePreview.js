import { LightningElement, api } from 'lwc';
import getPdfPreviewPage from '@salesforce/apex/DocgenAsyncController.getPdfPreviewPage';

const JPEG_CONTENT_TYPE = 'image/jpeg';
const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';
const MAX_PREVIEW_PAGES = 20;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export default class DocgenPdfImagePreview extends LightningElement {
  _generatedDocumentId;
  isConnectedToDom = false;
  loadSequence = 0;
  pageImageUrl = null;
  displayedPageNumber = 0;
  requestedPageNumber = 1;
  failedPageNumber = null;
  pageCount = 0;
  previewPageCount = 0;
  previewTruncated = false;
  isLoading = false;
  errorMessage = null;

  @api
  get generatedDocumentId() {
    return this._generatedDocumentId;
  }

  set generatedDocumentId(value) {
    const normalizedValue = value || null;
    if (normalizedValue === this._generatedDocumentId) {
      return;
    }

    this._generatedDocumentId = normalizedValue;
    this.resetPreview();
    if (this.isConnectedToDom && normalizedValue) {
      this.loadPage(1);
    }
  }

  connectedCallback() {
    this.isConnectedToDom = true;
    if (this.generatedDocumentId) {
      this.loadPage(1);
    }
  }

  disconnectedCallback() {
    this.isConnectedToDom = false;
    this.loadSequence += 1;
  }

  get hasGeneratedDocument() {
    return Boolean(this.generatedDocumentId);
  }

  get hasPageImage() {
    return Boolean(this.pageImageUrl);
  }

  get showNavigation() {
    return this.hasPageImage && this.pageCount > 0;
  }

  get navigationPageNumber() {
    return this.isLoading ? this.requestedPageNumber : this.displayedPageNumber;
  }

  get previousDisabled() {
    return !this.showNavigation || this.navigationPageNumber <= 1;
  }

  get nextDisabled() {
    return !this.showNavigation || this.navigationPageNumber >= this.previewPageCount;
  }

  get pageStatus() {
    return `Page ${this.displayedPageNumber} of ${this.pageCount}`;
  }

  get imageAlternativeText() {
    return `PDF preview page ${this.displayedPageNumber} of ${this.pageCount}`;
  }

  get loadingAlternativeText() {
    return `Loading PDF preview page ${this.requestedPageNumber}`;
  }

  get retryButtonLabel() {
    return `Retry page ${this.failedPageNumber}`;
  }

  get truncationMessage() {
    return `Preview is limited to the first ${this.previewPageCount} of ${this.pageCount} pages.`;
  }

  resetPreview() {
    this.loadSequence += 1;
    this.pageImageUrl = null;
    this.displayedPageNumber = 0;
    this.requestedPageNumber = 1;
    this.failedPageNumber = null;
    this.pageCount = 0;
    this.previewPageCount = 0;
    this.previewTruncated = false;
    this.isLoading = false;
    this.errorMessage = null;
  }

  async loadPage(pageNumber) {
    const requestedPage = Number(pageNumber);
    const generatedDocumentId = this.generatedDocumentId;
    if (
      !this.isConnectedToDom ||
      !generatedDocumentId ||
      !Number.isInteger(requestedPage) ||
      requestedPage < 1 ||
      (this.previewPageCount > 0 && requestedPage > this.previewPageCount)
    ) {
      return;
    }

    const sequence = ++this.loadSequence;
    this.requestedPageNumber = requestedPage;
    this.failedPageNumber = null;
    this.errorMessage = null;
    this.isLoading = true;

    try {
      const response = await getPdfPreviewPage({
        generatedDocumentId,
        pageNumber: requestedPage,
      });
      if (!this.isCurrentRequest(sequence, generatedDocumentId)) {
        return;
      }

      const page = this.normalizePageResponse(response, requestedPage);
      this.pageImageUrl = `${JPEG_DATA_URL_PREFIX}${page.base64Data}`;
      this.displayedPageNumber = page.pageNumber;
      this.requestedPageNumber = page.pageNumber;
      this.pageCount = page.pageCount;
      this.previewPageCount = page.previewPageCount;
      this.previewTruncated = page.previewTruncated;
    } catch (error) {
      if (!this.isCurrentRequest(sequence, generatedDocumentId)) {
        return;
      }

      this.failedPageNumber = requestedPage;
      this.requestedPageNumber = this.displayedPageNumber || requestedPage;
      this.errorMessage = `Unable to load preview page ${requestedPage}. ${this.extractErrorMessage(error)}`;
    } finally {
      if (this.isCurrentRequest(sequence, generatedDocumentId)) {
        this.isLoading = false;
      }
    }
  }

  normalizePageResponse(response, requestedPage) {
    const contentType = String(response?.contentType || '').toLowerCase();
    const base64Data = String(response?.base64Data || '').replace(/\s/g, '');
    const pageNumber = Number(response?.pageNumber);
    const pageCount = Number(response?.pageCount);
    const returnedPreviewPageCount = Number(response?.previewPageCount);

    if (contentType !== JPEG_CONTENT_TYPE) {
      throw new Error('The preview service returned an unsupported image format.');
    }
    if (!base64Data || !BASE64_PATTERN.test(base64Data)) {
      throw new Error('The preview service returned invalid image data.');
    }
    if (!Number.isInteger(pageNumber) || pageNumber !== requestedPage) {
      throw new Error('The preview service returned the wrong page.');
    }
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new Error('The preview service returned an invalid page count.');
    }
    if (!Number.isInteger(returnedPreviewPageCount) || returnedPreviewPageCount < 1) {
      throw new Error('The preview service returned an invalid preview page count.');
    }

    const previewPageCount = Math.min(returnedPreviewPageCount, pageCount, MAX_PREVIEW_PAGES);
    if (pageNumber > previewPageCount) {
      throw new Error('The preview service returned a page outside the preview range.');
    }

    return {
      base64Data,
      pageNumber,
      pageCount,
      previewPageCount,
      previewTruncated: response?.previewTruncated === true || pageCount > previewPageCount,
    };
  }

  isCurrentRequest(sequence, generatedDocumentId) {
    return (
      this.isConnectedToDom &&
      sequence === this.loadSequence &&
      generatedDocumentId === this.generatedDocumentId
    );
  }

  handlePrevious() {
    if (!this.previousDisabled) {
      this.loadPage(this.navigationPageNumber - 1);
    }
  }

  handleNext() {
    if (!this.nextDisabled) {
      this.loadPage(this.navigationPageNumber + 1);
    }
  }

  handleRetry() {
    this.loadPage(this.failedPageNumber);
  }

  handleContextMenu(event) {
    event.preventDefault();
  }

  handleDragStart(event) {
    event.preventDefault();
  }

  extractErrorMessage(error) {
    return error?.body?.message || error?.message || 'Check your connection and retry the page.';
  }
}
