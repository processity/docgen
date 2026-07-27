import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { MAX_PREVIEW_IMAGE_BYTES, PdfPageRenderResult } from './types';

const GHOSTSCRIPT_BINARY = 'gs';
const GHOSTSCRIPT_TIMEOUT_MS = 20_000;
const GHOSTSCRIPT_MAX_BUFFER_BYTES = 1024 * 1024;

const RENDER_PROFILES = [
  { dpi: 180, quality: 92 },
  { dpi: 135, quality: 82 },
  { dpi: 96, quality: 68 },
] as const;

export type PdfPreviewRenderErrorCode =
  | 'INVALID_PDF'
  | 'PAGE_OUT_OF_RANGE'
  | 'RENDER_TIMEOUT'
  | 'RENDER_FAILED'
  | 'OUTPUT_TOO_LARGE';

export class PdfPreviewRenderError extends Error {
  constructor(
    readonly code: PdfPreviewRenderErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PdfPreviewRenderError';
  }
}

export interface GhostscriptRunOptions {
  timeoutMs: number;
}

export type GhostscriptExecutor = (
  args: readonly string[],
  options: GhostscriptRunOptions
) => Promise<void>;

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: {
    timeout: number;
    killSignal: NodeJS.Signals;
    maxBuffer: number;
    windowsHide: boolean;
  },
  callback: ExecFileCallback
) => unknown;

export function createGhostscriptExecutor(
  execFileImpl: ExecFileLike = execFile as unknown as ExecFileLike
): GhostscriptExecutor {
  return async (args, options) => {
    await new Promise<void>((resolve, reject) => {
      execFileImpl(
        GHOSTSCRIPT_BINARY,
        args,
        {
          timeout: options.timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: GHOSTSCRIPT_MAX_BUFFER_BYTES,
          windowsHide: true,
        },
        (error) => {
          if (!error) {
            resolve();
            return;
          }

          const processError = error as Error & {
            killed?: boolean;
            signal?: NodeJS.Signals;
          };
          const timedOut = processError.killed === true && processError.signal === 'SIGKILL';
          reject(
            new PdfPreviewRenderError(
              timedOut ? 'RENDER_TIMEOUT' : 'RENDER_FAILED',
              timedOut ? 'PDF preview rendering timed out' : 'PDF preview rendering failed'
            )
          );
        }
      );
    });
  };
}

export class PdfPageRenderer {
  constructor(
    private readonly executeGhostscript: GhostscriptExecutor = createGhostscriptExecutor(),
    private readonly timeoutMs = GHOSTSCRIPT_TIMEOUT_MS,
    private readonly maxImageBytes = MAX_PREVIEW_IMAGE_BYTES
  ) {}

  async renderPage(pdfData: Buffer, pageNumber: number): Promise<PdfPageRenderResult> {
    const pageCount = await this.countPages(pdfData);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new PdfPreviewRenderError(
        'PAGE_OUT_OF_RANGE',
        'Requested preview page is outside the PDF page range'
      );
    }

    const workDir = await mkdtemp(path.join(tmpdir(), 'docgen-preview-'));
    const inputPath = path.join(workDir, 'input.pdf');
    const outputPath = path.join(workDir, 'page.jpg');

    try {
      await writeFile(inputPath, pdfData, { flag: 'wx' });

      for (const profile of RENDER_PROFILES) {
        const imageData = await this.renderAttempt(
          inputPath,
          outputPath,
          pageNumber,
          profile.dpi,
          profile.quality
        );

        if (imageData.length <= this.maxImageBytes) {
          return { imageData, pageCount };
        }
      }

      throw new PdfPreviewRenderError(
        'OUTPUT_TOO_LARGE',
        'Rendered PDF preview page exceeds the response size limit'
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async countPages(pdfData: Buffer): Promise<number> {
    try {
      const document = await PDFDocument.load(pdfData, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
      const pageCount = document.getPageCount();
      if (pageCount < 1) {
        throw new Error('PDF has no pages');
      }
      return pageCount;
    } catch {
      throw new PdfPreviewRenderError('INVALID_PDF', 'Generated PDF is malformed or encrypted');
    }
  }

  private async renderAttempt(
    inputPath: string,
    outputPath: string,
    pageNumber: number,
    dpi: number,
    quality: number
  ): Promise<Buffer> {
    await unlink(outputPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });

    const args = [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-dUseCropBox',
      '-dTextAlphaBits=4',
      '-dGraphicsAlphaBits=4',
      '-sDEVICE=jpeg',
      `-dJPEGQ=${quality}`,
      `-r${dpi}`,
      `-dFirstPage=${pageNumber}`,
      `-dLastPage=${pageNumber}`,
      `-sOutputFile=${outputPath}`,
      inputPath,
    ] as const;

    try {
      await this.executeGhostscript(args, { timeoutMs: this.timeoutMs });
      return await readFile(outputPath);
    } catch (error) {
      if (error instanceof PdfPreviewRenderError) {
        throw error;
      }
      throw new PdfPreviewRenderError('RENDER_FAILED', 'PDF preview rendering failed');
    }
  }
}
