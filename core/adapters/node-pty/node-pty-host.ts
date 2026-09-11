// node-pty over ConPTY — P0-T1 proved the round trip on Node 26 and 20 (RESEARCH.md A.1).
//
// A thin wrapper on purpose. The only behaviour it adds is idempotent `kill()`: node-pty throws if
// a process is killed twice, and a pane closing while its session is already exiting is an
// ordinary race, not an error anyone should see.
import { spawn as spawnPty, type IPty } from 'node-pty';
import type { PtyHost, PtyProcess, PtySpec } from '../../ports/pty-host.ts';

export class NodePtyHost implements PtyHost {
  public spawn(spec: PtySpec): PtyProcess {
    const pty = spawnPty(spec.command, [...spec.args], {
      name: 'xterm-256color',
      cols: spec.cols,
      rows: spec.rows,
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
      env: { ...spec.env },
    });
    return new NodePtyProcess(pty);
  }
}

class NodePtyProcess implements PtyProcess {
  private readonly pty: IPty;
  private exited = false;

  constructor(pty: IPty) {
    this.pty = pty;
    this.pty.onExit(() => {
      this.exited = true;
    });
  }

  public get pid(): number {
    return this.pty.pid;
  }

  public write(data: string): void {
    if (!this.exited) this.pty.write(data);
  }

  public resize(cols: number, rows: number): void {
    // A resize after exit throws on ConPTY, and a pane fitting itself as the session ends is the
    // normal way to reach that (RESEARCH.md A.1).
    if (!this.exited) this.pty.resize(cols, rows);
  }

  public kill(): void {
    if (this.exited) return;
    this.exited = true;
    this.pty.kill();
  }

  public onData(listener: (data: string) => void): void {
    this.pty.onData(listener);
  }

  public onExit(listener: (code: number) => void): void {
    this.pty.onExit(({ exitCode }) => {
      listener(exitCode);
    });
  }
}
