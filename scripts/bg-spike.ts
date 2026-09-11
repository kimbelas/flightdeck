// P0-T4 — drives `claude` background verbs and records what a real ConPTY sees.
//
// The deck attaches to background sessions inside node-pty (P5a-T1), so the shapes this spike
// captures have to come from a real pseudo-terminal, not from a piped child process: Claude Code
// renders a TUI and refuses to attach twice, and neither behaviour is observable over a pipe.
//
// Raw captures land under fixtures/raw/ (git-ignored); scripts/capture-fixtures.mjs scrubs them.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn as spawnPty, type IPty } from 'node-pty';

const execFileAsync = promisify(execFile);

/** A keystroke to send once the session has had time to draw. */
export interface Keystroke {
  readonly afterMs: number;
  readonly data: string;
  readonly label: string;
}

export interface PtyProbeOptions {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly configDir: string;
  readonly cols: number;
  readonly rows: number;
}

export interface PtyProbeResult {
  readonly output: string;
  readonly bytes: number;
  readonly firstByteMs: number;
  readonly totalMs: number;
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly exitedOnItsOwn: boolean;
  readonly keysSent: readonly string[];
}

/**
 * Runs one `claude` verb inside a ConPTY and returns everything the terminal received.
 *
 * The process is killed at `budgetMs` if it has not exited — `attach` never exits on its own,
 * which is the point of the exclusivity test. Callers get `exitedOnItsOwn` to tell the two apart.
 */
export class PtyProbe {
  private readonly options: PtyProbeOptions;

  constructor(options: PtyProbeOptions) {
    this.options = options;
  }

  /** Minimal environment for a child process — SECURITY.md §3 rule 5. */
  private static environment(configDir: string): Record<string, string> {
    const inherited = ['PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'SystemRoot'];
    const env: Record<string, string> = { CLAUDE_CONFIG_DIR: configDir };
    for (const name of inherited) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }

  private static settle(
    terminal: IPty,
    budgetMs: number,
  ): Promise<{ exitCode: number | null; signal: number | null; exitedOnItsOwn: boolean }> {
    return new Promise((resolve) => {
      let done = false;
      const budget = setTimeout(() => {
        if (done) return;
        done = true;
        terminal.kill();
        resolve({ exitCode: null, signal: null, exitedOnItsOwn: false });
      }, budgetMs);

      terminal.onExit(({ exitCode, signal }) => {
        if (done) return;
        done = true;
        clearTimeout(budget);
        resolve({ exitCode, signal: signal ?? null, exitedOnItsOwn: true });
      });
    });
  }

  public async run(
    budgetMs: number,
    keystrokes: readonly Keystroke[] = [],
  ): Promise<PtyProbeResult> {
    const started = performance.now();
    const chunks: string[] = [];
    const keysSent: string[] = [];
    let firstByteMs = -1;

    const terminal: IPty = spawnPty(this.options.binary, [...this.options.args], {
      name: 'xterm-256color',
      cols: this.options.cols,
      rows: this.options.rows,
      cwd: this.options.cwd,
      env: PtyProbe.environment(this.options.configDir),
    });

    terminal.onData((data: string) => {
      if (firstByteMs < 0) firstByteMs = performance.now() - started;
      chunks.push(data);
    });

    const timers = keystrokes.map((key) =>
      setTimeout(() => {
        keysSent.push(key.label);
        terminal.write(key.data);
      }, key.afterMs),
    );

    const outcome = await PtyProbe.settle(terminal, budgetMs);
    for (const timer of timers) clearTimeout(timer);

    return {
      output: chunks.join(''),
      bytes: Buffer.byteLength(chunks.join(''), 'utf8'),
      firstByteMs,
      totalMs: performance.now() - started,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      exitedOnItsOwn: outcome.exitedOnItsOwn,
      keysSent,
    };
  }
}

export interface VerbResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

/**
 * Runs a non-interactive `claude` verb with an argument array (SEC-PROC-1) and a timeout.
 * Never throws on a non-zero exit — a refusal is data this spike is trying to record.
 */
export class ClaudeVerb {
  private static readonly TIMEOUT_MS = 20_000;

  private readonly binary: string;
  private readonly configDir: string;

  constructor(binary: string, configDir: string) {
    this.binary = binary;
    this.configDir = configDir;
  }

  public async run(args: readonly string[], cwd: string): Promise<VerbResult> {
    const started = performance.now();
    try {
      const { stdout, stderr } = await execFileAsync(this.binary, [...args], {
        cwd,
        env: { ...process.env, CLAUDE_CONFIG_DIR: this.configDir },
        timeout: ClaudeVerb.TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0, durationMs: performance.now() - started };
    } catch (error: unknown) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        exitCode: failure.code ?? -1,
        durationMs: performance.now() - started,
      };
    }
  }
}

/** Strips ANSI so a captured TUI frame can be asserted on as text. */
/* eslint-disable no-control-regex -- stripping ANSI means matching ESC and BEL; that is the point. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\][0-9]+;[^\x07\x1B]*[\x07\x1B]/g, '')
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[()][A-Z0-9]/g, '')
    .replace(/\x1B[=>]/g, '');
}
/* eslint-enable no-control-regex */

/** The non-empty text lines of a captured frame, in order, de-duplicated consecutively. */
export function visibleLines(text: string): readonly string[] {
  const lines = stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim().length > 0);
  return lines.filter((line, index) => line !== lines[index - 1]);
}
