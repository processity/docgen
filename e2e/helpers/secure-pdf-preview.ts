import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { getScratchOrgInfo } from '../utils/scratch-org';

export const PREVIEW_E2E_CONFIG_ENV = 'OTO3827_PREVIEW_E2E_CONFIG';

export type PreviewSource = 'direct' | 'composite';
export type PreviewFormat = 'PDF' | 'DOCX' | 'PPTX' | 'XLSX';

export interface PreviewScenario {
  url: string;
  generateButton: string;
  timeoutMs: number;
  componentSelector: string;
  fixtureName: string;
}

export type PreviewScenarioResolution =
  | { status: 'ready'; scenario: PreviewScenario }
  | { status: 'missing'; reason: string }
  | { status: 'invalid'; reason: string };

interface RawPreviewScenario {
  url?: unknown;
  generateButton?: unknown;
  timeoutMs?: unknown;
  componentSelector?: unknown;
  fixtureName?: unknown;
}

interface RawPreviewConfig {
  direct?: Record<string, RawPreviewScenario>;
  composite?: Record<string, RawPreviewScenario>;
}

interface LoadedPreviewConfig {
  config?: RawPreviewConfig;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 240_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const SOURCE_COMPONENT_SELECTORS: Record<PreviewSource, string> = {
  direct: 'c-docgen-progress-button',
  composite: 'c-composite-docgen-button',
};

const RAW_FILE_URL_PATTERNS = [
  /\/sfc\/servlet\.shepherd\/(?:version|document)\/download\//i,
  /\/servlet\/servlet\.FileDownload/i,
  /\/lightning\/r\/Content(?:Version|Document)\//i,
];

const RAW_FILE_DOM_SELECTOR = [
  'iframe',
  'embed',
  'object',
  '[src^="blob:"]',
  '[href^="blob:"]',
  '[src^="file:"]',
  '[href^="file:"]',
  '[src^="data:application/pdf"]',
  '[href^="data:application/pdf"]',
  '[src*="/sfc/servlet.shepherd/"]',
  '[href*="/sfc/servlet.shepherd/"]',
  '[src*="/lightning/r/ContentVersion/"]',
  '[href*="/lightning/r/ContentVersion/"]',
  '[src*="/lightning/r/ContentDocument/"]',
  '[href*="/lightning/r/ContentDocument/"]',
].join(', ');

let cachedConfig: LoadedPreviewConfig | undefined;

/**
 * Expected JSON shape:
 * {
 *   "direct": {
 *     "PDF": { "url": "/lightning/...", "generateButton": "Generate PDF" },
 *     "DOCX": { "url": "/lightning/...", "generateButton": "Generate DOCX" },
 *     "XLSX": { "url": "/lightning/...", "generateButton": "Generate XLSX" }
 *   },
 *   "composite": {
 *     "PDF": { "url": "/lightning/...", "generateButton": "Generate PDF" }
 *   }
 * }
 *
 * Each URL must open a dedicated Salesforce test surface with the requested
 * template/composite record already selected and preview-before-save enabled.
 */
export function resolvePreviewScenario(
  source: PreviewSource,
  format: PreviewFormat
): PreviewScenarioResolution {
  const loaded = loadPreviewConfig();
  if (loaded.error) {
    return { status: 'invalid', reason: loaded.error };
  }

  const sourceConfig = loaded.config?.[source];
  const rawScenario = sourceConfig?.[format] ?? sourceConfig?.[format.toLowerCase()];
  if (!rawScenario) {
    return {
      status: 'missing',
      reason:
        `${source} ${format} secure preview fixture is not configured. ` +
        `Add ${source}.${format} to ${PREVIEW_E2E_CONFIG_ENV}.`,
    };
  }

  const url = readRequiredString(rawScenario.url);
  const generateButton = readRequiredString(rawScenario.generateButton);
  if (!url || !generateButton) {
    return {
      status: 'invalid',
      reason:
        `${PREVIEW_E2E_CONFIG_ENV}.${source}.${format} must contain non-empty ` +
        '`url` and `generateButton` strings.',
    };
  }

  const timeoutMs = normalizeTimeout(rawScenario.timeoutMs);
  if (timeoutMs === null) {
    return {
      status: 'invalid',
      reason:
        `${PREVIEW_E2E_CONFIG_ENV}.${source}.${format}.timeoutMs must be an integer ` +
        `between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`,
    };
  }

  const componentSelector =
    readOptionalString(rawScenario.componentSelector) ?? SOURCE_COMPONENT_SELECTORS[source];
  const fixtureName =
    readOptionalString(rawScenario.fixtureName) ?? `${source} ${format} preview fixture`;

  return {
    status: 'ready',
    scenario: {
      url,
      generateButton,
      timeoutMs,
      componentSelector,
      fixtureName,
    },
  };
}

export interface OpenPreviewSurfaceResult {
  surface?: Oto3827PreviewSurface;
  unavailableReason?: string;
}

export async function openPreviewSurface(
  page: Page,
  scenario: PreviewScenario
): Promise<OpenPreviewSurfaceResult> {
  const orgInfo = await getScratchOrgInfo();
  const instanceUrl = new URL(orgInfo.instanceUrl);

  await page.context().addCookies([
    {
      name: 'sid',
      value: orgInfo.accessToken,
      domain: instanceUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
    {
      name: 'inst',
      value: instanceUrl.hostname.split('.')[0],
      domain: instanceUrl.hostname,
      path: '/',
      secure: true,
      sameSite: 'None',
    },
  ]);

  const configuredUrl = new URL(scenario.url, orgInfo.instanceUrl);
  const targetUrl = new URL(
    `${configuredUrl.pathname}${configuredUrl.search}${configuredUrl.hash}`,
    orgInfo.instanceUrl
  ).toString();

  await page.goto(targetUrl, { waitUntil: 'load', timeout: scenario.timeoutMs });

  const unavailableMessage = page.getByText(
    /URL No Longer Exists|couldn't find the record|record.*(?:deleted|unavailable)|Insufficient Privileges/i
  );
  if (
    await unavailableMessage
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return {
      unavailableReason:
        `${scenario.fixtureName} is unavailable in the authenticated Salesforce org: ` +
        `${(await unavailableMessage.first().textContent())?.trim() || 'record unavailable'}`,
    };
  }

  const generateButton = page
    .getByRole('button', { name: scenario.generateButton, exact: true })
    .first();
  await expect(
    generateButton,
    `${scenario.fixtureName} must expose the configured generation button`
  ).toBeVisible({ timeout: scenario.timeoutMs });
  await expect(generateButton).toBeEnabled();

  return {
    surface: new Oto3827PreviewSurface(page, scenario, generateButton),
  };
}

export interface PdfNavigationResult {
  pageCount: number;
  navigationSupported: boolean;
}

export interface PreviewContractSnapshot {
  hasCancel: boolean;
  hasSave: boolean;
  hasDownload: boolean;
  hasImageViewer: boolean;
  hasRawFileSurface: boolean;
}

export class Oto3827PreviewSurface {
  readonly page: Page;
  readonly scenario: PreviewScenario;
  readonly generateButton: Locator;
  readonly component: Locator;
  readonly transferMonitor: RawPdfTransferMonitor;

  constructor(page: Page, scenario: PreviewScenario, generateButton: Locator) {
    this.page = page;
    this.scenario = scenario;
    this.generateButton = generateButton;
    this.component = page.locator(scenario.componentSelector).last();
    this.transferMonitor = new RawPdfTransferMonitor(page);
  }

  get previewRegion(): Locator {
    return this.component.getByRole('region', { name: 'Generated document preview' });
  }

  get savedRegion(): Locator {
    return this.component.getByRole('region', { name: 'Generated document saved' });
  }

  get pdfViewer(): Locator {
    return this.component.getByRole('region', { name: 'PDF document preview' });
  }

  get cancelButton(): Locator {
    return this.component.getByRole('button', { name: 'Cancel', exact: true });
  }

  get saveButton(): Locator {
    return this.component.getByRole('button', { name: 'Save', exact: true });
  }

  get downloadButton(): Locator {
    return this.savedRegion.getByRole('button', { name: 'Download', exact: true });
  }

  async generate(): Promise<void> {
    this.transferMonitor.start();
    await this.generateButton.click();

    await expect(
      this.component,
      `${this.scenario.fixtureName} must render its DocGen generation component`
    ).toBeAttached({ timeout: this.scenario.timeoutMs });
    await expect(this.previewRegion).toBeVisible({ timeout: this.scenario.timeoutMs });
    await expect(this.cancelButton).toBeVisible();
    await expect(this.saveButton).toBeVisible();
    await expect(this.downloadButton).toHaveCount(0);
  }

  async assertPendingPdfSecurity(): Promise<void> {
    await expect(this.pdfViewer).toBeVisible({ timeout: this.scenario.timeoutMs });

    const image = this.pdfViewer.getByRole('img', { name: /PDF preview page \d+ of \d+/ });
    await expect(image).toBeVisible({ timeout: this.scenario.timeoutMs });
    await expect(image).toHaveAttribute('src', /^data:image\/jpeg;base64,/);

    await expect(this.component.locator(RAW_FILE_DOM_SELECTOR)).toHaveCount(0);
    await expect(
      this.component.getByRole('button', { name: 'Open generated file', exact: true })
    ).toHaveCount(0);
    await expect(
      this.component.getByRole('link', { name: /Open generated document/i })
    ).toHaveCount(0);
    await this.transferMonitor.expectNoRawPdfTransfer();
  }

  async exercisePdfNavigation(): Promise<PdfNavigationResult> {
    const image = this.pdfViewer.getByRole('img', { name: /PDF preview page \d+ of \d+/ });
    const previous = this.pdfViewer.getByRole('button', { name: 'Previous', exact: true });
    const next = this.pdfViewer.getByRole('button', { name: 'Next', exact: true });

    await expect(image).toBeVisible({ timeout: this.scenario.timeoutMs });
    const initialAlternativeText = await image.getAttribute('alt');
    const pageCount = parsePageCount(initialAlternativeText);

    await expect(previous).toBeDisabled();
    if (pageCount < 2) {
      await expect(next).toBeDisabled();
      return { pageCount, navigationSupported: false };
    }

    await expect(next).toBeEnabled();
    await next.click();
    await expect(image).toHaveAttribute('alt', `PDF preview page 2 of ${pageCount}`, {
      timeout: this.scenario.timeoutMs,
    });
    await expect(previous).toBeEnabled();

    await previous.click();
    await expect(image).toHaveAttribute('alt', `PDF preview page 1 of ${pageCount}`, {
      timeout: this.scenario.timeoutMs,
    });
    await expect(previous).toBeDisabled();
    await this.transferMonitor.expectNoRawPdfTransfer();

    return { pageCount, navigationSupported: true };
  }

  async assertUnsupportedPreview(format: Exclude<PreviewFormat, 'PDF'>): Promise<void> {
    await expect(this.previewRegion).toContainText(new RegExp(format, 'i'));
    await expect(this.previewRegion).toContainText(/preview/i);
    await expect(this.previewRegion).toContainText(/not (?:available|supported)|unsupported/i);
    await expect(this.previewRegion).toContainText(/save/i);
    await expect(this.pdfViewer).toHaveCount(0);
    await expect(this.component.locator(RAW_FILE_DOM_SELECTOR)).toHaveCount(0);
    await this.transferMonitor.expectNoRawPdfTransfer();
  }

  async snapshotPendingContract(): Promise<PreviewContractSnapshot> {
    return {
      hasCancel: await this.cancelButton.isVisible(),
      hasSave: await this.saveButton.isVisible(),
      hasDownload: await this.downloadButton.isVisible().catch(() => false),
      hasImageViewer: await this.pdfViewer.isVisible().catch(() => false),
      hasRawFileSurface: (await this.component.locator(RAW_FILE_DOM_SELECTOR).count()) > 0,
    };
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.previewRegion).toBeHidden({ timeout: this.scenario.timeoutMs });
    await expect(this.savedRegion).toHaveCount(0);
    await expect(this.downloadButton).toHaveCount(0);
  }

  async saveAndVerifyDownload(): Promise<string> {
    await expect(this.downloadButton).toHaveCount(0);
    await this.saveButton.click();

    await expect(this.savedRegion).toBeVisible({ timeout: this.scenario.timeoutMs });
    await expect(this.cancelButton).toHaveCount(0);
    await expect(this.saveButton).toHaveCount(0);
    await expect(this.downloadButton).toBeVisible();

    const existingPages = new Set(this.page.context().pages());
    const downloadRequest = this.page.context().waitForEvent('request', {
      predicate: (request) => isSalesforceFileRequest(request),
      timeout: this.scenario.timeoutMs,
    });

    await this.downloadButton.click();
    const request = await downloadRequest;

    for (const contextPage of this.page.context().pages()) {
      if (!existingPages.has(contextPage)) {
        await contextPage.close().catch(() => undefined);
      }
    }

    return request.url();
  }
}

class RawPdfTransferMonitor {
  private readonly page: Page;
  private readonly rawTransferUrls = new Set<string>();
  private readonly responseChecks: Promise<void>[] = [];
  private started = false;

  constructor(page: Page) {
    this.page = page;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.page.on('request', (request) => {
      if (isSalesforceFileRequest(request)) {
        this.rawTransferUrls.add(request.url());
      }
    });
    this.page.on('response', (response) => {
      this.responseChecks.push(this.inspectResponse(response));
    });
  }

  async expectNoRawPdfTransfer(): Promise<void> {
    await Promise.all(this.responseChecks);
    expect(
      [...this.rawTransferUrls],
      'The pending preview must not transfer the original PDF or expose a Salesforce file URL'
    ).toEqual([]);
  }

  private async inspectResponse(response: Response): Promise<void> {
    const contentType = await response.headerValue('content-type').catch(() => null);
    if (contentType && /^application\/pdf(?:;|$)/i.test(contentType.trim())) {
      this.rawTransferUrls.add(response.url());
    }
  }
}

function loadPreviewConfig(): LoadedPreviewConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawValue = process.env[PREVIEW_E2E_CONFIG_ENV];
  if (!rawValue?.trim()) {
    cachedConfig = { config: {} };
    return cachedConfig;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      cachedConfig = {
        error: `${PREVIEW_E2E_CONFIG_ENV} must be a JSON object.`,
      };
      return cachedConfig;
    }
    cachedConfig = { config: parsed as RawPreviewConfig };
  } catch (error) {
    cachedConfig = {
      error:
        `${PREVIEW_E2E_CONFIG_ENV} contains invalid JSON: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return cachedConfig;
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTimeout(value: unknown): number | null {
  if (value === undefined || value === null) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (
    !Number.isInteger(value) ||
    Number(value) < MIN_TIMEOUT_MS ||
    Number(value) > MAX_TIMEOUT_MS
  ) {
    return null;
  }
  return Number(value);
}

function parsePageCount(alternativeText: string | null): number {
  const match = alternativeText?.match(/^PDF preview page 1 of (\d+)$/);
  if (!match) {
    throw new Error(`Unexpected PDF preview image label: ${alternativeText || '<empty>'}`);
  }

  return Number(match[1]);
}

function isSalesforceFileRequest(request: Request): boolean {
  return RAW_FILE_URL_PATTERNS.some((pattern) => pattern.test(request.url()));
}
