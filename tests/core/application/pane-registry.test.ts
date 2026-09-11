// Attach exclusivity — SEC-WS-3, and the one guarantee the CLI does not provide.
//
// RESEARCH.md F.2.6 measured that `claude attach` is last-one-wins inside node-pty: the second
// attach succeeds and evicts the first. Every test here exists because that eviction is silent and
// would corrupt a session the user is typing into.
import { describe, expect, it } from 'vitest';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import { PaneRegistry } from '../../../core/application/pane-registry.ts';
import { ConsoleLogger } from '../../../core/adapters/console-logger.ts';
import type { PtyCommands, TerminalSize } from '../../../core/ports/pty-commands.ts';
import type { PtySpec } from '../../../core/ports/pty-host.ts';
import { FakePtyHost } from '../../fakes/fake-pty-host.ts';

const SIZE: TerminalSize = { cols: 80, rows: 24 };
const SESSION: PtyTarget = {
  kind: 'session',
  sessionId: '11111111-2222-3333-4444-555555555555',
  subscription: '365',
};
const OTHER_SESSION: PtyTarget = {
  kind: 'session',
  sessionId: '99999999-8888-7777-6666-555555555555',
  subscription: '365',
};
const SAME_ID_OTHER_SUB: PtyTarget = {
  kind: 'session',
  sessionId: '11111111-2222-3333-4444-555555555555',
  subscription: 'isg',
};
const SHELL: PtyTarget = { kind: 'shell' };

class StubCommands implements PtyCommands {
  public runnable = true;

  public forTarget(target: PtyTarget, size: TerminalSize): PtySpec | undefined {
    if (!this.runnable) return undefined;
    return {
      command: 'fake.exe',
      args: target.kind === 'session' ? ['attach', target.sessionId] : [],
      cwd: undefined,
      cols: size.cols,
      rows: size.rows,
      env: {},
    };
  }
}

function registry(): { panes: PaneRegistry; host: FakePtyHost; commands: StubCommands } {
  const host = new FakePtyHost();
  const commands = new StubCommands();
  const silent = new ConsoleLogger({ write: () => true } as unknown as NodeJS.WritableStream);
  return { panes: new PaneRegistry(host, commands, silent), host, commands };
}

describe('PaneRegistry — exclusivity', () => {
  it('refuses a second pane on a session already held', () => {
    const { panes } = registry();
    expect(panes.open(SESSION, SIZE).ok).toBe(true);

    const second = panes.open(SESSION, SIZE);

    expect(second).toEqual({ ok: false, error: 'held_elsewhere' });
  });

  it('spawns nothing for the refused second pane', () => {
    const { panes, host } = registry();
    panes.open(SESSION, SIZE);

    panes.open(SESSION, SIZE);

    expect(host.spawned).toHaveLength(1);
  });

  it('allows a different session at the same time', () => {
    const { panes } = registry();
    panes.open(SESSION, SIZE);

    expect(panes.open(OTHER_SESSION, SIZE).ok).toBe(true);
  });

  it('treats the same id in the other subscription as a different session', () => {
    const { panes } = registry();
    panes.open(SESSION, SIZE);

    // Ids are only unique within a config dir, so the subscription is part of the key.
    expect(panes.open(SAME_ID_OTHER_SUB, SIZE).ok).toBe(true);
  });

  it('never holds a shell — any number may be open', () => {
    const { panes } = registry();

    expect(panes.open(SHELL, SIZE).ok).toBe(true);
    expect(panes.open(SHELL, SIZE).ok).toBe(true);
    expect(panes.open(SHELL, SIZE).ok).toBe(true);
    expect(panes.openPaneCount).toBe(3);
  });

  it('releases the hold when the pane closes, so the session can be re-attached', () => {
    const { panes } = registry();
    const first = panes.open(SESSION, SIZE);
    if (!first.ok) throw new Error('setup failed');

    panes.close(first.value.id);

    expect(panes.open(SESSION, SIZE).ok).toBe(true);
  });

  it('releases the hold when the attach exits on its own', () => {
    const { panes, host } = registry();
    panes.open(SESSION, SIZE);

    host.last?.finish(0);

    expect(panes.open(SESSION, SIZE).ok).toBe(true);
  });

  it('says cannot_run when nothing can be spawned for the target', () => {
    const { panes, commands } = registry();
    commands.runnable = false;

    expect(panes.open(SESSION, SIZE)).toEqual({ ok: false, error: 'cannot_run' });
  });
});

describe('PaneRegistry — lifecycle', () => {
  it('kills the attach process when a pane closes', () => {
    const { panes, host } = registry();
    const opened = panes.open(SHELL, SIZE);
    if (!opened.ok) throw new Error('setup failed');

    panes.close(opened.value.id);

    expect(host.last?.killed).toBe(true);
  });

  it('is idempotent — a socket close and a process exit both land here', () => {
    const { panes } = registry();
    const opened = panes.open(SHELL, SIZE);
    if (!opened.ok) throw new Error('setup failed');

    panes.close(opened.value.id);
    panes.close(opened.value.id);

    expect(panes.openPaneCount).toBe(0);
  });

  it('does not let a stale pane release the hold its successor now owns', () => {
    const { panes } = registry();
    const first = panes.open(SESSION, SIZE);
    if (!first.ok) throw new Error('setup failed');
    panes.close(first.value.id);
    const second = panes.open(SESSION, SIZE);
    if (!second.ok) throw new Error('re-open failed');

    panes.close(first.value.id);

    // The successor still holds it: a duplicate close of the old pane must not free the session.
    expect(panes.open(SESSION, SIZE)).toEqual({ ok: false, error: 'held_elsewhere' });
  });

  it('closes every pane on shutdown so no attach outlives core', () => {
    const { panes, host } = registry();
    panes.open(SHELL, SIZE);
    panes.open(SESSION, SIZE);

    panes.closeAll();

    expect(panes.openPaneCount).toBe(0);
    expect(host.spawned.every((process) => process.killed)).toBe(true);
  });

  it('passes the requested size through to the spawn', () => {
    const { panes, host } = registry();

    panes.open(SHELL, { cols: 120, rows: 40 });

    expect(host.last?.spec).toMatchObject({ cols: 120, rows: 40 });
  });
});
