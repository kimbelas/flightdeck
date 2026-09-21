// Detach first, then open — P6-T2, and the order is the whole test.
import { describe, expect, it } from 'vitest';
import type { ProcessRequest, ProcessResult } from '../../../core/ports/process-runner.ts';
import type { PopoutSpec } from '../../../core/ports/terminal-commands.ts';
import type { PtyTarget } from '../../../contracts/pty-protocol.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';
import { SessionPopper } from '../../../core/application/session-popper.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const REF: SessionRef = {
  sessionId: '337975f9-c9c0-454a-a22a-2d53a86e0ea9',
  shortId: '337975f9',
  subscription: '365',
};

const COMMAND: ProcessRequest = {
  command: 'C:\\wt.exe',
  args: ['-w', '0', 'nt'],
  env: {},
  timeoutMs: 1,
};

const OK: ProcessResult = { code: 0, stdout: '', stderr: '', timedOut: false };

/** Everything that happened, in the order it happened. The order is what this file is about. */
class Trace {
  public readonly steps: string[] = [];
  public held = true;

  public releaseFor(target: PtyTarget): boolean {
    this.steps.push(`release:${target.kind}`);
    const was = this.held;
    this.held = false;
    return was;
  }
}

function build(
  over: {
    readonly command?: ProcessRequest | undefined;
    readonly result?: ProcessResult;
    readonly trace?: Trace;
  } = {},
): { popper: SessionPopper; trace: Trace; store: FakeStore; specs: PopoutSpec[] } {
  const trace = over.trace ?? new Trace();
  const store = new FakeStore();
  const specs: PopoutSpec[] = [];
  const popper = new SessionPopper({
    terminals: {
      popout: (spec) => {
        trace.steps.push('popout');
        specs.push(spec);
        return Promise.resolve('command' in over ? over.command : COMMAND);
      },
    },
    panes: trace,
    runner: {
      run: () => {
        trace.steps.push('run');
        return Promise.resolve(over.result ?? OK);
      },
    },
    audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
    logger: new FakeLogger(),
  });
  return { popper, trace, store, specs };
}

describe('SessionPopper', () => {
  // `claude attach` is last-one-wins: a second attach evicts the first, silently, ~2.4 s later
  // (F.2.6). Reversed, the two attaches race and the survivor is whichever won.
  it('releases the pane BEFORE it asks for a terminal', async () => {
    const { popper, trace } = build();

    await popper.popOut({ ref: REF, title: 'alpha', cwd: 'C:\\repo' });

    expect(trace.steps).toEqual(['release:session', 'popout', 'run']);
  });

  it('says whether a pane was actually released', async () => {
    const { popper } = build();

    expect(await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined })).toEqual({
      ok: true,
      value: true,
    });
  });

  // Popping out a session with no pane open is a perfectly good thing to do.
  it('opens the terminal anyway when nothing held the session', async () => {
    const trace = new Trace();
    trace.held = false;
    const { popper } = build({ trace });

    expect(await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined })).toEqual({
      ok: true,
      value: false,
    });
    expect(trace.steps).toContain('run');
  });

  it('hands the terminal the short id and the subscription, and nothing else about the session', async () => {
    const { popper, specs } = build();

    await popper.popOut({ ref: REF, title: 'alpha', cwd: 'C:\\repo' });

    expect(specs).toEqual([
      { shortId: '337975f9', subscription: '365', title: 'alpha', cwd: 'C:\\repo' },
    ]);
  });

  it('refuses when there is no terminal to pop out into, without running anything', async () => {
    const { popper, trace } = build({ command: undefined });

    expect(await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined })).toEqual({
      ok: false,
      error: 'no_terminal',
    });
    expect(trace.steps).not.toContain('run');
  });

  // The pane is already gone by then, which is the honest outcome: the owner asked to leave.
  it('still detaches when the terminal cannot be found', async () => {
    const { popper, trace } = build({ command: undefined });

    await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined });

    expect(trace.held).toBe(false);
  });

  it('reports a spawn that failed', async () => {
    const { popper } = build({ result: { ...OK, code: 1, stderr: 'nope' } });

    expect(await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined })).toEqual({
      ok: false,
      error: 'popout_failed',
    });
  });

  it('reports a spawn that timed out, rather than calling it opened', async () => {
    const { popper } = build({ result: { ...OK, timedOut: true } });

    expect(await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined })).toEqual({
      ok: false,
      error: 'popout_failed',
    });
  });

  // SEC-PROC-3: every mutating action writes a row, and this one starts a process.
  it('writes an audit row naming the session', async () => {
    const { popper, store } = build();

    await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined });

    expect(store.allAudit.at(-1)).toMatchObject({
      action: 'session.popout',
      target: REF.sessionId,
      outcome: 'ok',
    });
  });

  it('writes a refused row when there was nothing to pop out into', async () => {
    const { popper, store } = build({ command: undefined });

    await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined });

    expect(store.allAudit.at(-1)).toMatchObject({ action: 'session.popout', outcome: 'refused' });
  });

  it('writes a failed row when the spawn failed', async () => {
    const { popper, store } = build({ result: { ...OK, code: 1, stderr: '' } });

    await popper.popOut({ ref: REF, title: 'alpha', cwd: undefined });

    expect(store.allAudit.at(-1)).toMatchObject({ action: 'session.popout', outcome: 'failed' });
  });
});
