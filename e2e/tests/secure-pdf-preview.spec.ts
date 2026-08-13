import { expect, test, type Page } from '@playwright/test';
import {
  openPreviewSurface,
  resolvePreviewScenario,
  type Oto3827PreviewSurface,
  type PreviewFormat,
  type PreviewScenario,
  type PreviewScenarioResolution,
  type PreviewSource,
} from '../helpers/secure-pdf-preview';

const SOURCES: PreviewSource[] = ['direct', 'composite'];
const UNSUPPORTED_PREVIEW_FORMATS: Array<Exclude<PreviewFormat, 'PDF'>> = ['DOCX', 'PPTX', 'XLSX'];
const DOWNLOAD_URL_PATTERN =
  /\/sfc\/servlet\.shepherd\/(?:version|document)\/download\/|\/servlet\/servlet\.FileDownload/i;

test.describe('secure preview and post-save download', () => {
  for (const source of SOURCES) {
    const pdfResolution = resolvePreviewScenario(source, 'PDF');

    test.describe(`${source} PDF preview`, () => {
      configureScenarioSuite(pdfResolution);

      test('uses the shared image-preview and Cancel contract', async ({ page }) => {
        const scenario = requireReadyScenario(pdfResolution);
        test.setTimeout(scenario.timeoutMs + 30_000);

        const surface = await requireAvailableSurface(page, scenario);
        let isPending = false;

        try {
          await surface.generate();
          isPending = true;
          await surface.assertPendingPdfSecurity();

          expect(await surface.snapshotPendingContract()).toEqual({
            hasCancel: true,
            hasSave: true,
            hasDownload: false,
            hasImageViewer: true,
            hasRawFileSurface: false,
          });

          await surface.cancel();
          isPending = false;
        } finally {
          if (isPending) {
            await bestEffortCancel(surface);
          }
        }
      });

      test('supports Previous and Next navigation when the fixture is multi-page', async ({
        page,
      }) => {
        const scenario = requireReadyScenario(pdfResolution);
        test.setTimeout(scenario.timeoutMs + 30_000);

        const surface = await requireAvailableSurface(page, scenario);
        let isPending = false;

        try {
          await surface.generate();
          isPending = true;
          await surface.assertPendingPdfSecurity();

          const navigation = await surface.exercisePdfNavigation();
          await surface.cancel();
          isPending = false;

          test.skip(
            !navigation.navigationSupported,
            `${scenario.fixtureName} generated ${navigation.pageCount} page; ` +
              'configure a multi-page PDF fixture to exercise Previous and Next.'
          );
        } finally {
          if (isPending) {
            await bestEffortCancel(surface);
          }
        }
      });

      test('exposes Download only after Save', async ({ page }) => {
        const scenario = requireReadyScenario(pdfResolution);
        test.setTimeout(scenario.timeoutMs + 30_000);

        const surface = await requireAvailableSurface(page, scenario);
        let isPending = false;

        try {
          await surface.generate();
          isPending = true;
          await surface.assertPendingPdfSecurity();

          const downloadUrl = await surface.saveAndVerifyDownload();
          isPending = false;
          expect(downloadUrl).toMatch(DOWNLOAD_URL_PATTERN);
        } finally {
          if (isPending) {
            await bestEffortCancel(surface);
          }
        }
      });
    });

    for (const format of UNSUPPORTED_PREVIEW_FORMATS) {
      const resolution = resolvePreviewScenario(source, format);

      test.describe(`${source} ${format} preview`, () => {
        configureScenarioSuite(resolution);

        test('requires Save before Download and does not render a preview', async ({ page }) => {
          const scenario = requireReadyScenario(resolution);
          test.setTimeout(scenario.timeoutMs + 30_000);

          const surface = await requireAvailableSurface(page, scenario);
          let isPending = false;

          try {
            await surface.generate();
            isPending = true;
            await surface.assertUnsupportedPreview(format);

            const downloadUrl = await surface.saveAndVerifyDownload();
            isPending = false;
            expect(downloadUrl).toMatch(DOWNLOAD_URL_PATTERN);
          } finally {
            if (isPending) {
              await bestEffortCancel(surface);
            }
          }
        });
      });
    }
  }
});

function configureScenarioSuite(resolution: PreviewScenarioResolution): void {
  if (resolution.status === 'missing') {
    test.skip(true, resolution.reason);
  }
  if (resolution.status === 'invalid') {
    test.beforeAll(() => {
      throw new Error(resolution.reason);
    });
  }
}

function requireReadyScenario(resolution: PreviewScenarioResolution): PreviewScenario {
  if (resolution.status !== 'ready') {
    throw new Error(
      resolution.status === 'invalid'
        ? resolution.reason
        : 'Scenario body ran despite its missing-configuration skip.'
    );
  }
  return resolution.scenario;
}

async function requireAvailableSurface(
  page: Page,
  scenario: PreviewScenario
): Promise<Oto3827PreviewSurface> {
  const result = await openPreviewSurface(page, scenario);
  if (result.unavailableReason) {
    test.skip(true, result.unavailableReason);
    throw new Error('Unreachable after test.skip');
  }
  if (!result.surface) {
    throw new Error(`${scenario.fixtureName} did not provide a preview surface.`);
  }
  return result.surface;
}

async function bestEffortCancel(surface: Oto3827PreviewSurface): Promise<void> {
  if (await surface.cancelButton.isVisible().catch(() => false)) {
    await surface.cancel().catch(() => undefined);
  }
}
