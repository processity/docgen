import { spawn } from 'child_process';

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

interface ProcessOptions {
  timeout: number;
  maxBuffer: number;
}

/**
 * Own the whole conversion process group, including the soffice shell's children.
 * Keep the pool slot until the child is reaped and its output streams have closed.
 * The container's init process reaps any orphaned grandchildren.
 */
export function runConversionProcess(
  command: string,
  args: string[],
  options: ProcessOptions
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const useProcessGroup = process.platform !== 'win32';
    const child = spawn(command, args, {
      detached: useProcessGroup,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    let timedOut = false;

    const killProcessGroup = (): void => {
      if (child.pid === undefined) return; // A failed spawn owns no process group.
      try {
        if (useProcessGroup) {
          process.kill(-child.pid, 'SIGKILL');
        } else if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      } catch (error) {
        // An already exited group is the normal success path.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          failure ??= error as Error;
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup();
    }, options.timeout);

    const collect = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const chunks = stream === 'stdout' ? stdout : stderr;
      const bytes = stream === 'stdout' ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, options.maxBuffer - bytes);
      chunks.push(chunk.subarray(0, remaining));
      if (stream === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (chunk.length > remaining) {
        failure ??= Object.assign(new Error(`${stream} exceeded maxBuffer`), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        });
        killProcessGroup();
      }
    };

    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.once('error', (error) => {
      failure ??= error;
    });
    // A launcher can exit while a helper still holds the output pipe open.
    // Clean up at exit, rather than waiting indefinitely for the close event.
    child.once('exit', killProcessGroup);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const output = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      };
      if (failure || timedOut || code !== 0) {
        const error =
          failure ??
          Object.assign(
            new Error(
              timedOut ? `${command} timed out` : `${command} exited with ${signal ?? code}`
            ),
            { code: code ?? signal }
          );
        reject(Object.assign(error, output, { timedOut, signal }));
      } else {
        resolve(output);
      }
    });
  });
}
