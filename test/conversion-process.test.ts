import { runConversionProcess } from '../src/convert/process';

describe('conversion process lifecycle', () => {
  it('collects stdout and stderr on success', async () => {
    await expect(
      runConversionProcess(
        process.execPath,
        ['-e', "process.stdout.write('pdf'); process.stderr.write('warning');"],
        { timeout: 3000, maxBuffer: 1024 }
      )
    ).resolves.toEqual({
      stdout: 'pdf',
      stderr: 'warning',
    });
  });

  it('preserves a nonzero exit code and diagnostic output', async () => {
    await expect(
      runConversionProcess(
        process.execPath,
        [
          '-e',
          "process.stdout.write('output'); process.stderr.write('failure'); process.exitCode = 7;",
        ],
        { timeout: 3000, maxBuffer: 1024 }
      )
    ).rejects.toMatchObject({
      code: 7,
      stdout: 'output',
      stderr: 'failure',
      timedOut: false,
    });
  });

  it('preserves spawn errno without waiting for the timeout', async () => {
    await expect(
      runConversionProcess('/nonexistent-docgen-converter', [], {
        timeout: 3000,
        maxBuffer: 1024,
      })
    ).rejects.toMatchObject({ code: 'ENOENT', timedOut: false });
  });

  it.each(['stdout', 'stderr'])('bounds %s output and kills the writer', async (stream) => {
    await expect(
      runConversionProcess(
        process.execPath,
        ['-e', `process.${stream}.write('x'.repeat(65536)); setInterval(() => {}, 1000);`],
        { timeout: 3000, maxBuffer: 128 }
      )
    ).rejects.toMatchObject({
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      timedOut: false,
      [stream]: 'x'.repeat(128),
    });
  });

  it('does not cancel another conversion when one process group times out', async () => {
    const timedOut = runConversionProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000);'],
      { timeout: 400, maxBuffer: 1024 }
    ).catch((error) => error);
    const successful = runConversionProcess(
      process.execPath,
      ['-e', "setTimeout(() => console.log('other conversion completed'), 800);"],
      { timeout: 3000, maxBuffer: 1024 }
    );
    const [failure, output] = await Promise.all([timedOut, successful]);
    expect(failure.timedOut).toBe(true);
    expect(output.stdout).toContain('other conversion completed');
  });

  const posixTest = process.platform === 'win32' ? it.skip : it;

  // A shell-like launcher with a grandchild that ignores SIGTERM. The grandchild
  // inherits the output pipe, so killing only the launcher would also hang close.
  const launcher = (exitImmediately: boolean): string => `
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e',
      "process.on('SIGTERM', () => {}); console.log('READY'); setInterval(() => {}, 1000);"
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', () => {
      console.log('CHILD_PID=' + child.pid);
      ${exitImmediately ? 'process.exit(0);' : ''}
    });
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `;

  async function assertChildGone(output: string): Promise<void> {
    const pid = Number(/CHILD_PID=(\d+)/.exec(output)?.[1]);
    expect(pid).toBeGreaterThan(0);
    try {
      for (let attempt = 0; attempt < 80; attempt++) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Conversion grandchild ${pid} survived cleanup`);
    } finally {
      // Keep a failing regression from leaking its deliberately hung fixture.
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* Already reaped. */
      }
    }
  }

  posixTest('kills SIGTERM-resistant descendants when conversion times out', async () => {
    const outcome = await runConversionProcess(process.execPath, ['-e', launcher(false)], {
      timeout: 1000,
      maxBuffer: 1024,
    }).then(
      () => {
        throw new Error('Expected timeout');
      },
      (error) => error
    );
    expect(outcome).toMatchObject({ timedOut: true, signal: 'SIGKILL' });
    await assertChildGone(outcome.stdout);
  });

  posixTest('cleans up helpers left behind by a successfully exiting launcher', async () => {
    const output = await runConversionProcess(process.execPath, ['-e', launcher(true)], {
      timeout: 3000,
      maxBuffer: 1024,
    });
    await assertChildGone(output.stdout);
  });
});
