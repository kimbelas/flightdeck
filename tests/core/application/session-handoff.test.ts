// Handing a conversation to a new working tree — P6-T6, SPEC §6(8), RESEARCH.md G.54.
//
// **Every assertion about the argv here is a measurement, not a preference.** G.54 forked a real
// session twice, at zero token cost, and found the three facts this class is built on: the fork
// runs in the PROCESS cwd rather than the original's folder, `-n` next to `--fork-session` names
// it, and the new id is only in stdout. Get any of them wrong and the handoff opens somewhere
// else, under the same name, and reports the id of the session it forked FROM.
import { describe, expect, it } from 'vitest';
import { SessionHandoff } from '../../../core/application/session-handoff.ts';
import type { ProjectRegistry } from '../../../core/application/project-registry.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import type { ProcessRequest, ProcessResult } from '../../../core/ports/process-runner.ts';
import { err, ok } from '../../../core/shared/result.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const SESSION = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const WORKTREE = 'C:\\repo\\.claude\\worktrees\\spike';

/** What `--bg` really prints, from G.54's probe. */
const FORKED: ProcessResult = {
  code: 0,
  stdout: 'backgrounded · b4977dd3 (idle — send a prompt to start)\n',
  stderr: '',
  timedOut: false,
};

const FAILED: ProcessResult = { code: 1, stdout: '', stderr: 'nope', timedOut: false };

interface Built {
  readonly handoff: SessionHandoff;
  readonly asked: ProcessRequest[];
  readonly store: FakeStore;
}

/**
 * `NONE` rather than `undefined` for "there isn't one".
 *
 * Passing `undefined` to a parameter that HAS a default selects the default, so three cases here
 * quietly built a healthy handoff and asserted that it refused. They failed, which is the system
 * working — but the shape is worth naming, because it fails the other way just as easily.
 */
const NONE = Symbol('none');

function build(
  result: ProcessResult = FORKED,
  resolved: string | typeof NONE = WORKTREE,
  executable: string | typeof NONE = 'C:\\claude.exe',
): Built {
  const asked: ProcessRequest[] = [];
  const store = new FakeStore();
  const registry = {
    resolveDirectory: () =>
      Promise.resolve(resolved === NONE ? err('not in a project') : ok(resolved)),
  };
  const handoff = new SessionHandoff({
    // `''` and not `undefined` for "not installed": `ClaudeInstall` reads `undefined` as "go and
    // look on disk", which on this machine FINDS one. The same shape as `NONE` above, one layer
    // down, and the reason that sentinel exists at all.
    install: new ClaudeInstall('C:\\home', executable === NONE ? '' : executable),
    registry: registry as unknown as ProjectRegistry,
    runner: {
      run: (request: ProcessRequest) => {
        asked.push(request);
        return Promise.resolve(result);
      },
    },
    audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
    logger: new FakeLogger(),
  });
  return { handoff, asked, store };
}

function requestOf(
  over: Partial<Parameters<SessionHandoff['handOff']>[0]> = {},
): Parameters<SessionHandoff['handOff']>[0] {
  return { subscription: '365', sessionId: SESSION, cwd: WORKTREE, name: 'spike', ...over };
}

describe('SessionHandoff — the command line G.54 measured', () => {
  it('forks with --fork-session and the FULL uuid', async () => {
    const { handoff, asked } = build();

    await handoff.handOff(requestOf());

    expect(asked[0]?.args).toEqual(['--bg', '--resume', SESSION, '--fork-session', '-n', 'spike']);
  });

  /**
   * The measurement the whole feature rested on.
   *
   * Had a resume restored the original session's directory, a handoff would have silently opened in
   * the old tree — P6-T1's "the one failure a terminal must not have". It runs in the process cwd,
   * so the cwd is what puts it in the worktree.
   */
  it('runs it IN the worktree, because that is where a fork lands', async () => {
    const { handoff, asked } = build();

    await handoff.handOff(requestOf());

    expect(asked[0]?.cwd).toBe(WORKTREE);
  });

  // Without `-n` both sessions wear the original's name, and two rows reading `fd-t2-live` in one
  // deck is a handoff nobody can follow (G.54).
  it('names the fork, so the deck does not show the same name twice', async () => {
    const { handoff, asked } = build();

    await handoff.handOff(requestOf({ name: '  try the other parser  ' }));

    expect(asked[0]?.args.at(-1)).toBe('try the other parser');
  });

  /**
   * A fork gets a NEW id, so the one we were given is the wrong answer.
   *
   * `SessionResumer` deliberately returns the id it was handed, because a correct resume keeps it.
   * This is the opposite case and the same discipline: report what actually happened.
   */
  it('answers with the NEW id out of stdout, never the one it was given', async () => {
    const { handoff } = build();

    const forked = await handoff.handOff(requestOf());

    expect(forked).toEqual(ok('b4977dd3'));
  });

  it('carries the subscription’s config directory, so the fork lands on the right account', async () => {
    const { handoff, asked } = build();

    await handoff.handOff(requestOf({ subscription: 'isg' }));

    expect(asked[0]?.env['CLAUDE_CONFIG_DIR']).toContain('isg');
  });
});

describe('SessionHandoff — what it refuses', () => {
  // F.2.7's control rather than input hygiene: a short id does not fail, it forks something else.
  it('refuses a short id without spawning anything', async () => {
    const { handoff, asked } = build();

    expect(await handoff.handOff(requestOf({ sessionId: '337975f9' }))).toEqual(err('bad_session'));
    expect(asked).toEqual([]);
  });

  it.each([
    { name: '', why: 'an empty name' },
    { name: '   ', why: 'a name that is only whitespace' },
    { name: 'a'.repeat(81), why: 'a name past the cap' },
  ])('refuses $why', async ({ name }) => {
    const { handoff, asked } = build();

    expect(await handoff.handOff(requestOf({ name }))).toEqual(err('bad_name'));
    expect(asked).toEqual([]);
  });

  /**
   * The folder is the registry's to judge, and this is the case that proves nothing is spawned
   * before it has (SEC-FS-1). A handoff names a directory, which no other session verb does.
   */
  it('refuses a folder outside every imported project, before spawning', async () => {
    const { handoff, asked } = build(FORKED, NONE);

    expect(await handoff.handOff(requestOf({ cwd: 'C:\\Windows\\System32' }))).toEqual(
      err('bad_cwd'),
    );
    expect(asked).toEqual([]);
  });

  // The registry's answer is what reaches the process, not what the request said — which is the
  // junction defence: `resolveDirectory` canonicalises before it screens.
  it('spawns in the folder the REGISTRY resolved, not the one it was sent', async () => {
    const { handoff, asked } = build(FORKED, 'C:\\repo\\real');

    await handoff.handOff(requestOf({ cwd: 'C:\\repo\\..\\repo\\real' }));

    expect(asked[0]?.cwd).toBe('C:\\repo\\real');
  });

  it('refuses when Claude Code is not installed, without looking anything up', async () => {
    const { handoff, asked } = build(FORKED, WORKTREE, NONE);

    expect(await handoff.handOff(requestOf())).toEqual(err('no_claude'));
    expect(asked).toEqual([]);
  });

  it('reports a failed fork as a failure', async () => {
    const { handoff } = build(FAILED);

    expect(await handoff.handOff(requestOf())).toEqual(err('handoff_failed'));
  });

  // Exit 0 with nothing to read means a fork may well exist. Telling the owner it failed is how
  // they make a second one (contracts/launch-reply.ts).
  it('tells an unreadable answer apart from a failure', async () => {
    const { handoff } = build({ code: 0, stdout: 'nothing useful', stderr: '', timedOut: false });

    expect(await handoff.handOff(requestOf())).toEqual(err('no_session_id'));
  });

  it('treats a timeout as a failure even when the code is zero', async () => {
    const { handoff } = build({ ...FORKED, timedOut: true });

    expect(await handoff.handOff(requestOf())).toEqual(err('handoff_failed'));
  });
});

describe('SessionHandoff — the audit row', () => {
  it('records the fork, naming both ids', async () => {
    const { handoff, store } = build();

    await handoff.handOff(requestOf());

    const row = store.auditSince(0, 10).at(-1);
    expect(row?.action).toBe('handoff');
    expect(row?.target).toBe(SESSION);
    expect(row?.outcome).toBe('ok');
    expect(row?.args).toContain('b4977dd3');
  });

  // The name is the owner's own text, and the argv rule bends for the fields that carry that into
  // a table kept forever (SEC-DATA-2).
  it('keeps the name out of the row, as a launch keeps the prompt out', async () => {
    const { handoff, store } = build();

    await handoff.handOff(requestOf({ name: 'refactor the billing rules' }));

    expect(store.auditSince(0, 10).at(-1)?.args.join(' ')).not.toContain('billing');
  });

  it.each([
    { make: () => build(FORKED, NONE), outcome: 'refused', why: 'a folder it may not use' },
    { make: () => build(FAILED), outcome: 'failed', why: 'a fork that failed' },
  ])('records $why as $outcome', async ({ make, outcome }) => {
    const { handoff, store } = make();

    await handoff.handOff(requestOf());

    expect(store.auditSince(0, 10).at(-1)?.outcome).toBe(outcome);
  });
});
