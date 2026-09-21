// The three decisions a pane makes — P5a-T6a.
//
// `PaneSocket` itself is not tested here and deliberately cannot be: it holds a `WebSocket`, a
// `MessageEvent` and a `CloseEvent`, and importing it into this project — which has `lib:
// ["ES2023"]` and no DOM, by tsconfig.app.json's rule — re-resolves those globals to Node's and
// shifts `ReadableStream` program-wide. That is not a hypothetical: the first draft of this file
// imported the socket, and `scripts/sse-probe.ts` started failing lint on a `for await` it had
// done since P0. The socket's wiring is covered by the smoke, which drives a real one.
import { describe, expect, it, vi } from 'vitest';
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import {
  ENDED_STATUSES,
  MAX_PENDING_CHARS,
  PaneStatusReporter,
  PendingInput,
  readPaneExit,
  reasonText,
} from '../../app/panes/pane-status.ts';

const SESSION: PtyTarget = {
  kind: 'session',
  sessionId: 'cfe7facb-a785-42e4-b1b3-600138ad1c70',
  subscription: '365',
};
const SHELL: PtyTarget = { kind: 'shell' };

describe('PendingInput — what was typed before the pane could send it', () => {
  it('gives it back in the order it was typed', () => {
    const pending = new PendingInput();
    pending.hold('h');
    pending.hold('e');
    pending.hold('llo');

    expect(pending.take()).toEqual(['h', 'e', 'llo']);
  });

  it('is empty after it has been taken, so a reconnect does not replay it', () => {
    const pending = new PendingInput();
    pending.hold('once');

    expect(pending.take()).toEqual(['once']);
    expect(pending.take()).toEqual([]);
    expect(pending.size).toBe(0);
  });

  it('accepts input right up to the bound', () => {
    const pending = new PendingInput();

    expect(pending.hold('x'.repeat(MAX_PENDING_CHARS))).toBe(true);
    expect(pending.size).toBe(MAX_PENDING_CHARS);
  });

  it('refuses what would cross it rather than holding a paste of any size', () => {
    const pending = new PendingInput();
    pending.hold('x'.repeat(MAX_PENDING_CHARS - 1));

    expect(pending.hold('yy')).toBe(false);
    // The refused chunk is not partially kept — a half-delivered paste is worse than none.
    expect(pending.size).toBe(MAX_PENDING_CHARS - 1);
  });

  it('is emptied by clear, which is what closing a pane does', () => {
    const pending = new PendingInput();
    pending.hold('lost');
    pending.clear();

    expect(pending.take()).toEqual([]);
  });
});

describe('PaneStatusReporter — which explanation for a dead pane wins', () => {
  it('passes ordinary updates straight through', () => {
    const seen = vi.fn();
    const reporter = new PaneStatusReporter(seen);
    reporter.update('connecting');
    reporter.update('live');

    expect(seen).toHaveBeenCalledTimes(2);
    expect(reporter.ended).toBe(false);
  });

  it('reports the first terminal status and swallows the second', () => {
    const seen = vi.fn();
    const reporter = new PaneStatusReporter(seen);
    // The `exit` frame lands first and says more than the socket close that follows it.
    reporter.finish('evicted', 'taken');
    reporter.finish('closed', undefined);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ status: 'evicted', detail: 'taken' });
    expect(reporter.ended).toBe(true);
  });

  it('ignores an update after the pane has ended', () => {
    const seen = vi.fn();
    const reporter = new PaneStatusReporter(seen);
    reporter.finish('closed');
    reporter.update('connecting', 'still typing');

    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('readPaneExit — an ending, an eviction, a stop, or nothing worth saying', () => {
  it('reads a clean exit nobody asked for as an eviction', () => {
    expect(readPaneExit(0, SESSION, 'nobody')).toEqual({
      status: 'evicted',
      detail: 'Another terminal attached to this session. Reattach to take it back.',
    });
  });

  it('says nothing when this side asked for the detach', () => {
    expect(readPaneExit(0, SESSION, 'detach')).toBeUndefined();
  });

  /**
   * The bug this case exists for shipped and was found by RUNNING it (P5a-T6).
   *
   * `claude stop` ends the session, so the attach PTY exits 0 with nobody having closed the pane —
   * byte for byte the eviction signal. The pane said "another terminal attached to this session"
   * about a session that had just been stopped from that very pane, and no test could have seen
   * it, because the only difference is which button was pressed on this side.
   */
  it('reads an exit this pane asked for by pressing stop as a stop, not an eviction', () => {
    expect(readPaneExit(0, SESSION, 'stop')).toEqual({
      status: 'stopped',
      detail: 'You stopped this session. Resume it from its row, then reattach.',
    });
  });

  it('says a stop is a stop whatever the exit code, because the pane knows why', () => {
    expect(readPaneExit(137, SESSION, 'stop')?.status).toBe('stopped');
  });

  it('reads a shell that exited as an ending — that is what typing `exit` does', () => {
    expect(readPaneExit(0, SHELL, 'nobody')).toEqual({
      status: 'closed',
      detail: 'session exited (0)',
    });
  });

  it('reads a non-zero exit as an ending even on a session', () => {
    expect(readPaneExit(1, SESSION, 'nobody')).toEqual({
      status: 'closed',
      detail: 'session exited (1)',
    });
  });

  it('reads an exit with no target as an ending rather than guessing at eviction', () => {
    expect(readPaneExit(0, undefined, 'nobody')?.status).toBe('closed');
  });

  it('offers reattach for a stop, because the row is where resuming lives (P4-T2a)', () => {
    expect(ENDED_STATUSES.has('stopped')).toBe(true);
  });
});

describe('the sentences a pane shows', () => {
  it('names the two refusals core can give', () => {
    expect(reasonText('held_elsewhere')).toBe('Already open in another pane or terminal.');
    expect(reasonText('cannot_run')).toBe('Claude Code was not found on this machine.');
  });

  it('passes anything else through rather than inventing a sentence for it', () => {
    expect(reasonText('something new')).toBe('something new');
  });

  it('offers reattach for every ending and for none of the working states', () => {
    expect([...ENDED_STATUSES].toSorted()).toEqual(['closed', 'evicted', 'refused', 'stopped']);
    expect(ENDED_STATUSES.has('live')).toBe(false);
    expect(ENDED_STATUSES.has('connecting')).toBe(false);
  });
});
