// Mock modules before import
jest.mock('child_process');
jest.mock('fs/promises');

// Create global mock for promisified execFile (must be before util mock)
const mockExecFileAsync = jest.fn();

// Mock promisify to return our mock for execFile
jest.mock('util', () => {
  const actualUtil = jest.requireActual('util');

  return {
    ...actualUtil,
    promisify: (fn: any) => {
      // If it's execFile, return the global mock
      if (fn && (fn.name === 'execFile' || String(fn).includes('execFile'))) {
        return mockExecFileAsync;
      }
      // Otherwise use actual promisify
      return actualUtil.promisify(fn);
    },
  };
});

import { LibreOfficeConverter, convertDocxToPdf } from '../src/convert/soffice';
import { promises as fsPromises } from 'fs';

describe('LibreOfficeConverter', () => {
  let converter: LibreOfficeConverter;

  beforeEach(() => {
    converter = new LibreOfficeConverter(8); // max 8 concurrent
    jest.clearAllMocks();
    jest.useRealTimers();

    // Set default mock implementations
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    fsPromises.mkdir.mockResolvedValue(undefined);
    fsPromises.writeFile.mockResolvedValue(undefined);
    fsPromises.readFile.mockResolvedValue(Buffer.from('mock pdf content'));
    fsPromises.rm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('convertToPdf', () => {
    it('should convert DOCX to PDF successfully', async () => {
      const docxBuffer = Buffer.from('mock docx content');
      const result = await converter.convertToPdf(docxBuffer, {
        correlationId: 'test-correlation-id',
      });

      // Verify result
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('mock pdf content');

      // Verify soffice was called
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'soffice',
        expect.arrayContaining(['--headless', '--convert-to', 'pdf']),
        expect.objectContaining({
          timeout: expect.any(Number),
        })
      );

      // Verify temp files were created and cleaned up
      expect(fsPromises.mkdir).toHaveBeenCalled();
      expect(fsPromises.writeFile).toHaveBeenCalled();
      expect(fsPromises.readFile).toHaveBeenCalled();
      expect(fsPromises.rm).toHaveBeenCalled();
    });

    it('should handle timeout by killing the process', async () => {
      // Mock hung process that times out
      mockExecFileAsync.mockRejectedValue({
        killed: true,
        signal: 'SIGTERM',
        message: 'Timeout',
      });

      const docxBuffer = Buffer.from('mock docx content');

      await expect(
        converter.convertToPdf(docxBuffer, {
          timeout: 1000,
          correlationId: 'timeout-test',
        })
      ).rejects.toThrow(/timeout|timed out/i);

      // Verify cleanup was attempted
      expect(fsPromises.rm).toHaveBeenCalled();
    });

    it('should handle process crash (non-zero exit code)', async () => {
      // Mock failed conversion
      const error: any = new Error('soffice exited with code 1');
      error.code = 1;
      mockExecFileAsync.mockRejectedValue(error);

      const docxBuffer = Buffer.from('mock docx content');

      await expect(
        converter.convertToPdf(docxBuffer, { correlationId: 'crash-test' })
      ).rejects.toThrow(/conversion failed|exited/i);

      // Verify cleanup was attempted even on error
      expect(fsPromises.rm).toHaveBeenCalled();

      // Verify stats tracked the failure
      const stats = converter.getStats();
      expect(stats.failedJobs).toBe(1);
    });

    it('should enforce max concurrent limit of 8', async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      // Mock conversion that tracks concurrency
      mockExecFileAsync.mockImplementation(() => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);

        return new Promise((resolve) => {
          setTimeout(() => {
            concurrentCalls--;
            resolve({ stdout: '', stderr: '' });
          }, 50);
        });
      });

      // Start 12 conversions
      const docxBuffer = Buffer.from('mock docx content');
      const promises = Array.from({ length: 12 }, (_, i) =>
        converter.convertToPdf(docxBuffer, {
          correlationId: `concurrent-test-${i}`,
        })
      );

      await Promise.all(promises);

      // Verify max concurrent was never more than 8
      expect(maxConcurrent).toBeLessThanOrEqual(8);
    });

    it('should track queue depth when pool is full', async () => {
      // Mock slow conversion
      mockExecFileAsync.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ stdout: '', stderr: '' });
          }, 100);
        });
      });

      const docxBuffer = Buffer.from('mock docx content');

      // Start 10 jobs (2 will queue)
      const promises = Array.from({ length: 10 }, (_, i) =>
        converter.convertToPdf(docxBuffer, {
          correlationId: `queue-test-${i}`,
        })
      );

      // Check stats during execution
      await new Promise((resolve) => setTimeout(resolve, 20));
      const midStats = converter.getStats();
      expect(midStats.activeJobs).toBeGreaterThan(0);

      await Promise.all(promises);

      // Final stats
      const finalStats = converter.getStats();
      expect(finalStats.completedJobs).toBe(10);
      expect(finalStats.activeJobs).toBe(0);
      expect(finalStats.queuedJobs).toBe(0);
    });

    it('should cleanup temp files even on error', async () => {
      // Mock readFile to throw after successful conversion
      fsPromises.readFile.mockRejectedValueOnce(new Error('File read failed'));

      const docxBuffer = Buffer.from('mock docx content');

      await expect(
        converter.convertToPdf(docxBuffer, { correlationId: 'cleanup-test' })
      ).rejects.toThrow(/File read failed/i);

      // Verify cleanup was still attempted
      expect(fsPromises.rm).toHaveBeenCalled();
    });

    it('should track stats correctly', async () => {
      const initialStats = converter.getStats();
      expect(initialStats.totalConversions).toBe(0);
      expect(initialStats.completedJobs).toBe(0);
      expect(initialStats.failedJobs).toBe(0);

      const docxBuffer = Buffer.from('mock docx content');

      // Successful conversion
      await converter.convertToPdf(docxBuffer, {
        correlationId: 'stats-test-1',
      });

      const afterSuccess = converter.getStats();
      expect(afterSuccess.totalConversions).toBe(1);
      expect(afterSuccess.completedJobs).toBe(1);
      expect(afterSuccess.failedJobs).toBe(0);

      // Failed conversion
      mockExecFileAsync.mockRejectedValueOnce(new Error('Conversion error'));

      await expect(
        converter.convertToPdf(docxBuffer, { correlationId: 'stats-test-2' })
      ).rejects.toThrow();

      const afterFailure = converter.getStats();
      expect(afterFailure.totalConversions).toBe(2);
      expect(afterFailure.completedJobs).toBe(1);
      expect(afterFailure.failedJobs).toBe(1);
    });

    it('should propagate correlation ID through logs', async () => {
      const docxBuffer = Buffer.from('mock docx content');
      const correlationId = 'test-correlation-123';

      await converter.convertToPdf(docxBuffer, { correlationId });

      // This test verifies the API accepts correlationId
      // Actual log verification would require log mocking
      expect(mockExecFileAsync).toHaveBeenCalled();
    });

    it('should use custom timeout when provided', async () => {
      const docxBuffer = Buffer.from('mock docx content');
      await converter.convertToPdf(docxBuffer, {
        timeout: 5000,
        correlationId: 'custom-timeout-test',
      });

      // Verify custom timeout is passed to execFile
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it('should use custom workdir when provided', async () => {
      const customWorkdir = '/custom/tmp';

      const docxBuffer = Buffer.from('mock docx content');
      await converter.convertToPdf(docxBuffer, {
        workdir: customWorkdir,
        correlationId: 'custom-workdir-test',
      });

      // Verify mkdir was called with custom workdir path
      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(customWorkdir),
        expect.any(Object)
      );
    });
  });

  describe('convertDocxToPdf convenience function', () => {
    it('should use the singleton instance', async () => {
      const docxBuffer = Buffer.from('mock docx content');
      const result = await convertDocxToPdf(docxBuffer, {
        correlationId: 'singleton-test',
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(mockExecFileAsync).toHaveBeenCalled();
    });
  });
});
