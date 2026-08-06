import { access, writeFile } from 'fs/promises';
import path from 'path';
import {
  createGhostscriptExecutor,
  GhostscriptExecutor,
  PdfPageRenderer,
  PdfPreviewRenderError,
} from '../../src/preview/pdf-page-renderer';
import { MAX_PREVIEW_IMAGE_BYTES } from '../../src/preview/types';
import { createPdfPreviewFixture } from '../fixtures/pdf-preview';

function outputPathFromArgs(args: readonly string[]): string {
  const outputArg = args.find((arg) => arg.startsWith('-sOutputFile='));
  if (!outputArg) {
    throw new Error('Missing output argument');
  }
  return outputArg.slice('-sOutputFile='.length);
}

describe('PdfPageRenderer', () => {
  it('counts pages and renders only the requested page with fixed Ghostscript arguments', async () => {
    const pdf = await createPdfPreviewFixture(3);
    const image = Buffer.from('jpeg-page-two');
    const calls: Array<{ args: readonly string[]; timeoutMs: number }> = [];
    let workDir = '';

    const executor: GhostscriptExecutor = async (args, options) => {
      calls.push({ args, timeoutMs: options.timeoutMs });
      const outputPath = outputPathFromArgs(args);
      workDir = path.dirname(outputPath);
      const inputPath = args[args.length - 1];
      await access(inputPath);
      await writeFile(outputPath, image);
    };

    const result = await new PdfPageRenderer(executor).renderPage(pdf, 2);

    expect(result).toEqual({ imageData: image, pageCount: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].timeoutMs).toBe(20_000);
    expect(calls[0].args).toEqual(
      expect.arrayContaining([
        '-dSAFER',
        '-dBATCH',
        '-dNOPAUSE',
        '-dTextAlphaBits=4',
        '-dGraphicsAlphaBits=4',
        '-sDEVICE=jpeg',
        '-dJPEGQ=92',
        '-r180',
        '-dFirstPage=2',
        '-dLastPage=2',
      ])
    );
    await expect(access(workDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('renders a capped page sequence from one temporary PDF', async () => {
    const pdf = await createPdfPreviewFixture(4);
    const calls: Array<readonly string[]> = [];
    let workDir = '';
    const executor: GhostscriptExecutor = async (args) => {
      calls.push([...args]);
      const outputPath = outputPathFromArgs(args);
      workDir = path.dirname(outputPath);
      const pageArgument = args.find((arg) => arg.startsWith('-dFirstPage='));
      await writeFile(outputPath, Buffer.from(`jpeg-${pageArgument}`));
    };

    const result = await new PdfPageRenderer(executor).renderPages(pdf, 2);

    expect(result.pageCount).toBe(4);
    expect(result.imagePages.map((page) => page.toString())).toEqual([
      'jpeg--dFirstPage=1',
      'jpeg--dFirstPage=2',
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0][calls[0].length - 1]).toBe(calls[1][calls[1].length - 1]);
    await expect(access(workDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an invalid multi-page preview limit before rendering', async () => {
    const pdf = await createPdfPreviewFixture(1);
    const executor = jest.fn<ReturnType<GhostscriptExecutor>, Parameters<GhostscriptExecutor>>();

    await expect(new PdfPageRenderer(executor).renderPages(pdf, 0)).rejects.toMatchObject({
      code: 'PAGE_OUT_OF_RANGE',
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it('uses the next render profile when the high-resolution JPEG is too large', async () => {
    const pdf = await createPdfPreviewFixture(1);
    const calls: Array<readonly string[]> = [];
    const executor: GhostscriptExecutor = async (args) => {
      calls.push([...args]);
      const outputPath = outputPathFromArgs(args);
      const content = calls.length === 1 ? Buffer.alloc(9) : Buffer.alloc(4, 1);
      await writeFile(outputPath, content);
    };

    const result = await new PdfPageRenderer(executor, 20_000, 8).renderPage(pdf, 1);

    expect(result.imageData).toEqual(Buffer.alloc(4, 1));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(['-dJPEGQ=92', '-r180']));
    expect(calls[1]).toEqual(expect.arrayContaining(['-dJPEGQ=82', '-r135']));
  });

  it('rejects an image that remains above the size cap after fallback rendering', async () => {
    const pdf = await createPdfPreviewFixture(1);
    let workDir = '';
    const calls: Array<readonly string[]> = [];
    const executor: GhostscriptExecutor = async (args) => {
      calls.push([...args]);
      const outputPath = outputPathFromArgs(args);
      workDir = path.dirname(outputPath);
      await writeFile(outputPath, Buffer.alloc(9));
    };

    await expect(new PdfPageRenderer(executor, 20_000, 8).renderPage(pdf, 1)).rejects.toMatchObject(
      { code: 'OUTPUT_TOO_LARGE' }
    );
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(expect.arrayContaining(['-dJPEGQ=68', '-r96']));
    await expect(access(workDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed PDFs and out-of-range pages without invoking Ghostscript', async () => {
    const executor = jest.fn<ReturnType<GhostscriptExecutor>, Parameters<GhostscriptExecutor>>();
    const renderer = new PdfPageRenderer(executor);

    await expect(renderer.renderPage(Buffer.from('not-a-pdf'), 1)).rejects.toMatchObject({
      code: 'INVALID_PDF',
    });

    const pdf = await createPdfPreviewFixture(2);
    await expect(renderer.renderPage(pdf, 3)).rejects.toMatchObject({
      code: 'PAGE_OUT_OF_RANGE',
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it('cleans its temporary directory when Ghostscript times out', async () => {
    const pdf = await createPdfPreviewFixture(1);
    let workDir = '';
    const executor: GhostscriptExecutor = async (args) => {
      workDir = path.dirname(outputPathFromArgs(args));
      throw new PdfPreviewRenderError('RENDER_TIMEOUT', 'PDF preview rendering timed out');
    };

    await expect(new PdfPageRenderer(executor).renderPage(pdf, 1)).rejects.toMatchObject({
      code: 'RENDER_TIMEOUT',
    });
    await expect(access(workDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('configures execFile with a hard timeout, SIGKILL, and no shell', async () => {
    const processError = Object.assign(new Error('raw process error'), {
      killed: true,
      signal: 'SIGKILL' as const,
    });
    const execFileImpl = jest.fn((_file, _args, _options, callback) => {
      callback(processError, '', 'sensitive stderr');
    });
    const executor = createGhostscriptExecutor(execFileImpl);

    await expect(executor(['-dSAFER'], { timeoutMs: 1234 })).rejects.toMatchObject({
      code: 'RENDER_TIMEOUT',
      message: 'PDF preview rendering timed out',
    });
    expect(execFileImpl).toHaveBeenCalledWith(
      'gs',
      ['-dSAFER'],
      {
        timeout: 1234,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      expect.any(Function)
    );
  });

  it('uses the required two-megabyte production image cap', () => {
    expect(MAX_PREVIEW_IMAGE_BYTES).toBe(2 * 1024 * 1024);
  });
});
