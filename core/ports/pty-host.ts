// Spawning a pseudo-terminal, as an interface, so everything above it can be tested without one.
//
// node-pty is a native addon: a test that spawns a real ConPTY is slow, platform-bound and leaves
// processes behind when it fails. FakePtyHost gives PaneRegistry and PtySocketServer a process
// they can drive frame by frame, and tests/win/ exercises the real one (§10.2).
export interface PtySpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly cols: number;
  readonly rows: number;
  /** The child's full environment. Built by PtyCommands, so nothing else decides which account
   *  a pane talks to — CLAUDE_CONFIG_DIR is set here or the pane hits the wrong subscription. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** One running pseudo-terminal. Owned by the pane that opened it and disposed with it. */
export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Ends the process. Safe to call twice; the second call is a no-op. */
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number) => void): void;
}

export interface PtyHost {
  /** @throws if the command cannot be spawned — a missing binary is a bug, not a user error. */
  spawn(spec: PtySpec): PtyProcess;
}
