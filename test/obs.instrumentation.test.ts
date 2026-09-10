/**
 * Verifies the pipeline stages are actually wired into the leaf services.
 *
 * The status page's "where the time goes" table is only meaningful if the
 * public entry points still route through timeStage(); a refactor that calls an
 * internal implementation directly would silently empty the panel. These tests
 * exercise the public functions and assert a stage sample was recorded.
 */

import { getPerformanceSnapshot, resetPerfMetrics } from '../src/obs/perf';
import { mergeTemplate } from '../src/templates/merge';
import { mergeXlsxTemplate } from '../src/templates/xlsx';
import { concatenateDocx } from '../src/templates/concatenate';
import { TemplateService } from '../src/templates/service';
import { templateCache } from '../src/templates/cache';
import type { MergeOptions, TemplateSection } from '../src/types';

jest.mock('docx-templates', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(Buffer.from('merged document content')),
  listCommands: jest.fn().mockResolvedValue([]),
}));

const MERGE_OPTIONS: MergeOptions = {
  locale: 'en-GB',
  timezone: 'Europe/London',
};

function stage(name: string) {
  return getPerformanceSnapshot().stages.find((entry) => entry.stage === name);
}

describe('Pipeline stage instrumentation', () => {
  beforeEach(() => {
    resetPerfMetrics();
    templateCache.reset();
  });

  afterAll(() => {
    resetPerfMetrics();
    templateCache.reset();
  });

  it('records a merge stage for DOCX merges', async () => {
    await mergeTemplate(Buffer.from('template'), { Account: { Name: 'Acme' } }, MERGE_OPTIONS);

    expect(stage('merge')).toMatchObject({ count: 1, errorCount: 0 });
  });

  it('records a merge stage for XLSX merges', async () => {
    // An invalid workbook still consumes time, and a failed stage must be counted.
    await expect(mergeXlsxTemplate(Buffer.from('not a workbook'), {})).rejects.toBeDefined();

    expect(stage('merge')).toMatchObject({ count: 1, errorCount: 1 });
  });

  it('records a concatenate stage', async () => {
    // A single section short-circuits and is returned as-is; the stage is still timed.
    const sections: TemplateSection[] = [
      { buffer: Buffer.from('single section'), sequence: 1, namespace: 'Account' },
    ];

    await concatenateDocx(sections, 'test-correlation');

    expect(stage('concatenate')).toMatchObject({ count: 1, errorCount: 0 });
  });

  it('records a templateFetch stage on a cache miss and on a cache hit', async () => {
    const contentVersionId = '068xx000000abcdXXX';
    const downloadContentVersion = jest.fn().mockResolvedValue(Buffer.from('template bytes'));
    const service = new TemplateService({ downloadContentVersion } as never);

    await service.getTemplate(contentVersionId, 'test-correlation');
    await service.getTemplate(contentVersionId, 'test-correlation');

    expect(downloadContentVersion).toHaveBeenCalledTimes(1);
    expect(stage('templateFetch')).toMatchObject({ count: 2, errorCount: 0 });
    expect(templateCache.getStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('records a failed templateFetch stage when the download fails', async () => {
    const downloadContentVersion = jest.fn().mockRejectedValue(new Error('network down'));
    const service = new TemplateService({ downloadContentVersion } as never);

    await expect(service.getTemplate('068xx000000abcdXXX')).rejects.toBeDefined();

    expect(stage('templateFetch')).toMatchObject({ count: 1, errorCount: 1 });
  });
});
