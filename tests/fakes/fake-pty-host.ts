// In-memory PtyHost — CODING-STANDARDS §10.1 (fakes, not mocks).
//
// It lets a test drive a "process" frame by frame: `emit()` plays output as if the child wrote it,
// `finish()` ends it. No native addon, no child process, no cleanup that can leak a PTY when an
// assertion fails. The real one is exercised in tests/win/.
import type { PtyHost, PtyProcess, PtySpec } from '../../core/ports/pty-host.ts';

export class FakePtyProcess implements PtyProcess {
  public readonly pid: number;
  public readonly spec: PtySpec;
  public readonly written: string[] = [];
  public readonly resizes: { cols: number; rows: number }[] = [];
  public killed = false;
  // Mirrors NodePtyProcess: a process exits once. Without this the fake re-fires onExit when
  // PaneRegistry kills it from inside its own exit handler, and the socket reports code 0 for a
  // session that exited 3 — which is a real bug in the fake, not in the code under test.
  private exited = false;
  private readonly dataListeners: ((data: string) => void)[] = [];
  private readonly exitListeners: ((code: number) => void)[] = [];

  constructor(pid: number, spec: PtySpec) {
    this.pid = pid;
    this.spec = spec;
  }

  public write(data: string): void {
    this.written.push(data);
  }

  public resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  public kill(): void {
    if (this.exited) return;
    this.killed = true;
    this.finish(0);
  }

  public onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  public onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener);
  }

  /** Plays output as if the child had written it. */
  public emit(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  /** Ends the process. Called by `kill()`, or directly to simulate a session exiting on its own. */
  public finish(code: number): void {
    if (this.exited) return;
    this.exited = true;
    for (const listener of this.exitListeners) listener(code);
  }
}

export class FakePtyHost implements PtyHost {
  public readonly spawned: FakePtyProcess[] = [];
  public failNext = false;

  public get last(): FakePtyProcess | undefined {
    return this.spawned.at(-1);
  }

  public spawn(spec: PtySpec): PtyProcess {
    if (this.failNext) throw new Error('spawn refused');
    const process = new FakePtyProcess(1000 + this.spawned.length, spec);
    this.spawned.push(process);
    return process;
  }
}
