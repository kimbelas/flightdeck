// `execFile` with an argument array and a hard timeout — SEC-PROC-1, CODING-STANDARDS §7.
//
// Never `exec`, never `shell: true`: a prompt or a session name reaching a shell is the whole
// class of bug SEC-PROC-1 exists to prevent, and the lint rule that bans the shell spawners cannot
// help if the argv is built as a string somewhere upstream.
//
// A non-zero exit is a value, not a throw. `claude agents --json` failing is an ordinary state —
// the binary is mid-update, the daemon is gone — and a sweep that throws every 10 s is worse than
// one that reports an empty listing and carries on.
import { execFile } from 'node:child_process';
import type { ProcessRequest, ProcessResult, ProcessRunner } from '../../ports/process-runner.ts';

export class ExecFileProcessRunner implements ProcessRunner {
  public run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve) => {
      execFile(
        request.command,
        [...request.args],
        {
          timeout: request.timeoutMs,
          env: { ...request.env },
          // A listing of a dozen sessions is a few KB; this is a backstop, not a budget.
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve({
            code: exitCodeOf(error),
            stdout,
            stderr,
            timedOut: isTimeout(error),
          });
        },
      );
    });
  }
}

/** `execFile`'s error carries the signal on a timeout and a numeric code otherwise. */
function isTimeout(error: unknown): boolean {
  return isExecError(error) && error.killed === true && error.code === undefined;
}

function exitCodeOf(error: unknown): number {
  if (error === null || error === undefined) return 0;
  if (isExecError(error) && typeof error.code === 'number') return error.code;
  return -1;
}

interface ExecError {
  readonly killed?: boolean;
  readonly code?: number | string;
}

function isExecError(error: unknown): error is ExecError {
  return typeof error === 'object' && error !== null;
}
