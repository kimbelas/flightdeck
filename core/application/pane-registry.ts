// Who holds which session, and the guarantee that only one pane does — SEC-WS-3, P5a-T1.
//
// **This is the only thing standing between two panes and a corrupted session.** F.2.6 measured
// that `claude attach` inside node-pty is *last-one-wins*: the CLI does not refuse a second
// attach, it accepts it and evicts the first, which exits cleanly ~2.4 s later. The docs say
// "Can't open — this session is running in another terminal"; the binary does not do that. So
// exclusivity cannot be delegated to the CLI and cannot be trusted from the client — it is
// enforced here, server-side, or it does not exist.
//
// Closing a pane kills the attach, not the session: F.2.6 confirmed every session kept its pid
// across a killed attach, which is what makes the P5a gate ("closing a pane never stops a
// session") true at the CLI level.
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import type { Logger } from '../ports/logger.ts';
import type { PtyCommands, TerminalSize } from '../ports/pty-commands.ts';
import type { PtyHost, PtyProcess } from '../ports/pty-host.ts';
import { err, ok, type Result } from '../shared/result.ts';

export type OpenFailure = 'held_elsewhere' | 'cannot_run';

export interface Pane {
  readonly id: string;
  readonly target: PtyTarget;
  readonly process: PtyProcess;
}

/** Two panes on the same session collide; two shells never do. */
function holderKey(target: PtyTarget): string | undefined {
  return target.kind === 'session' ? `${target.subscription}:${target.sessionId}` : undefined;
}

export class PaneRegistry {
  private readonly host: PtyHost;
  private readonly commands: PtyCommands;
  private readonly logger: Logger;
  private readonly panes = new Map<string, Pane>();
  private readonly holders = new Map<string, string>();
  private nextPaneId = 1;

  constructor(host: PtyHost, commands: PtyCommands, logger: Logger) {
    this.host = host;
    this.commands = commands;
    this.logger = logger;
  }

  public get openPaneCount(): number {
    return this.panes.size;
  }

  /**
   * Opens a pane on a target, or says why it could not.
   *
   * `held_elsewhere` is a normal answer, not an error: the deck renders it as the "held" state
   * (SPEC §5.2) rather than retrying. A shell is never held, so shells always open.
   */
  public open(target: PtyTarget, size: TerminalSize): Result<Pane, OpenFailure> {
    const key = holderKey(target);
    if (key !== undefined && this.holders.has(key)) return err('held_elsewhere');

    const spec = this.commands.forTarget(target, size);
    if (spec === undefined) return err('cannot_run');

    const id = `pane-${String(this.nextPaneId)}`;
    this.nextPaneId += 1;
    const pane: Pane = { id, target, process: this.host.spawn(spec) };

    this.panes.set(id, pane);
    if (key !== undefined) this.holders.set(key, id);
    // The pid is the session's attach process, not the session itself — see the header.
    this.logger.info('pane_opened', { pane: id, kind: target.kind, pid: pane.process.pid });

    // A pane whose process exits is gone whether or not the socket noticed, so it releases here
    // rather than waiting for a close frame that a dropped connection will never send.
    pane.process.onExit(() => {
      this.close(id);
    });
    return ok(pane);
  }

  /** Kills the attach and releases the hold. Idempotent — a socket close and an exit both land here. */
  public close(paneId: string): void {
    const pane = this.panes.get(paneId);
    if (pane === undefined) return;
    this.panes.delete(paneId);

    const key = holderKey(pane.target);
    // Only if this pane is still the holder: a pane that was already replaced must not release
    // the hold its successor now owns.
    if (key !== undefined && this.holders.get(key) === paneId) this.holders.delete(key);

    pane.process.kill();
    this.logger.info('pane_closed', { pane: paneId });
  }

  public find(paneId: string): Pane | undefined {
    return this.panes.get(paneId);
  }

  /** Closes every pane. The composition root calls this on shutdown so no attach outlives core. */
  public closeAll(): void {
    for (const paneId of [...this.panes.keys()]) this.close(paneId);
  }
}
