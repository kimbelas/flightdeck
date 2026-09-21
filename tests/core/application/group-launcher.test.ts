// Starting a whole preset group on one press — P6-T4, D17.
//
// The cases that matter most are the ones that start NOTHING. This is the most expensive button in
// Flightdeck: one press is N background sessions and N first turns of the owner's 5-hour window,
// so "refused the whole press" and "started six of forty" are not near-misses of each other.
import { describe, expect, it } from 'vitest';
import type { LaunchPreset } from '../../../contracts/launch-preset.ts';
import { MAX_GROUP_LAUNCH, type GroupLaunchReport } from '../../../contracts/preset-group.ts';
import { GroupLauncher } from '../../../core/application/group-launcher.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import type { LaunchFailure } from '../../../contracts/launch-reply.ts';
import type { LaunchRequest } from '../../../core/application/session-launcher.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

function presetOf(over: Partial<LaunchPreset> = {}): LaunchPreset {
  return {
    projectKey: 'c:\\repo',
    id: 'ticket',
    name: 'ticket',
    profileFn: 'claude-isg-ticket',
    cwd: 'C:\\repo',
    sessionName: 'fd-ticket',
    promptSource: 'literal',
    prompt: 'go',
    group: 'morning',
    builtIn: false,
    ...over,
  };
}

/** A launcher that answers whatever the test queued, and remembers what it was asked. */
class StubLauncher {
  public readonly asked: LaunchRequest[] = [];
  /** Resolved by the test, so a case can prove the launches overlap rather than queue. */
  public readonly gate: { release?: () => void } = {};
  private readonly answers = new Map<string, Result<string, LaunchFailure>>();
  private fallback: Result<string, LaunchFailure> = ok('session');

  public willAnswer(name: string, answer: Result<string, LaunchFailure>): void {
    this.answers.set(name, answer);
  }

  public willAnswerAll(answer: Result<string, LaunchFailure>): void {
    this.fallback = answer;
  }

  public async launch(request: LaunchRequest): Promise<Result<string, LaunchFailure>> {
    this.asked.push(request);
    if (this.gate.release !== undefined) {
      await new Promise<void>((done) => {
        const previous = this.gate.release;
        this.gate.release = (): void => {
          previous?.();
          done();
        };
      });
    }
    return this.answers.get(request.name) ?? this.fallback;
  }
}

function build(presets: readonly LaunchPreset[]): {
  groups: GroupLauncher;
  launcher: StubLauncher;
} {
  const launcher = new StubLauncher();
  const groups = new GroupLauncher({
    presets: { list: () => presets },
    launcher,
    logger: new FakeLogger(),
  });
  return { groups, launcher };
}

describe('GroupLauncher — what it starts', () => {
  it('starts every preset in the group', async () => {
    const { groups, launcher } = build([
      presetOf({ id: 'a', name: 'orchestrator', sessionName: 'fd-orch' }),
      presetOf({ id: 'b', name: 'ticket', sessionName: 'fd-ticket' }),
    ]);

    const launched = await groups.launch('morning');

    expect(launched.ok).toBe(true);
    expect(launcher.asked.map((request) => request.name)).toEqual(['fd-orch', 'fd-ticket']);
  });

  it('leaves presets in another group, and ungrouped ones, alone', async () => {
    const { groups, launcher } = build([
      presetOf({ id: 'a', sessionName: 'fd-morning' }),
      presetOf({ id: 'b', sessionName: 'fd-evening', group: 'evening' }),
      presetOf({ id: 'c', sessionName: 'fd-loose', group: undefined }),
    ]);

    await groups.launch('morning');

    expect(launcher.asked.map((request) => request.name)).toEqual(['fd-morning']);
  });

  // `Morning` and `morning` being two buttons a capital apart is a bug the owner would file
  // against themselves.
  it('matches the group name whatever the case, and around whitespace', async () => {
    const { groups, launcher } = build([presetOf({ group: 'Morning' })]);

    await groups.launch('  mOrNiNg  ');

    expect(launcher.asked.length).toBe(1);
  });

  // The same rule the single launch uses (`presetPrompt`), so a preset pressed alone and the same
  // preset pressed in a group cannot send different first prompts.
  it('sends a ticket preset the ticket prompt, not its empty literal one', async () => {
    const { groups, launcher } = build([
      presetOf({ promptSource: 'ticket', prompt: '', sessionName: 'PROJ-12' }),
    ]);

    await groups.launch('morning');

    expect(launcher.asked[0]?.prompt).toContain('PROJ-12');
  });

  it('carries each preset its own folder and profile function', async () => {
    const { groups, launcher } = build([
      presetOf({ id: 'a', sessionName: 'fd-a', cwd: 'C:\\repo\\one', profileFn: 'claude-365' }),
      presetOf({ id: 'b', sessionName: 'fd-b', cwd: 'C:\\repo\\two', profileFn: 'claude-isg' }),
    ]);

    await groups.launch('morning');

    expect(launcher.asked.map((request) => [request.cwd, request.profileFn])).toEqual([
      ['C:\\repo\\one', 'claude-365'],
      ['C:\\repo\\two', 'claude-isg'],
    ]);
  });

  // A group spans projects, because "morning" means the owner's morning rather than one
  // repository's (contracts/preset-group.ts).
  it('starts presets from different projects under one name', async () => {
    const { groups, launcher } = build([
      presetOf({ projectKey: 'c:\\one', id: 'a', sessionName: 'fd-a' }),
      presetOf({ projectKey: 'c:\\two', id: 'b', sessionName: 'fd-b' }),
    ]);

    await groups.launch('morning');

    expect(launcher.asked.length).toBe(2);
  });
});

describe('GroupLauncher — what it refuses, before anything starts', () => {
  it('refuses a group nobody has', async () => {
    const { groups, launcher } = build([presetOf()]);

    expect(await groups.launch('evening')).toEqual(err('unknown_group'));
    expect(launcher.asked).toEqual([]);
  });

  it('refuses an empty name rather than matching everything', async () => {
    const { groups, launcher } = build([presetOf()]);

    expect(await groups.launch('   ')).toEqual(err('unknown_group'));
    expect(launcher.asked).toEqual([]);
  });

  /**
   * The cap refuses the WHOLE press rather than launching the first six.
   *
   * A group of forty is somebody having tagged a project by accident, and finding that out should
   * not cost forty first turns. A press that half-fired would leave the owner working out which
   * half, with the quota already gone.
   */
  it('refuses a group larger than the cap, and starts none of it', async () => {
    const tooMany = Array.from({ length: MAX_GROUP_LAUNCH + 1 }, (unused, index) =>
      presetOf({ id: `p${String(index)}`, sessionName: `fd-${String(index)}` }),
    );
    const { groups, launcher } = build(tooMany);

    expect(await groups.launch('morning')).toEqual(err('too_many'));
    expect(launcher.asked).toEqual([]);
  });

  it('accepts a group exactly at the cap', async () => {
    const atCap = Array.from({ length: MAX_GROUP_LAUNCH }, (unused, index) =>
      presetOf({ id: `p${String(index)}`, sessionName: `fd-${String(index)}` }),
    );
    const { groups, launcher } = build(atCap);

    expect((await groups.launch('morning')).ok).toBe(true);
    expect(launcher.asked.length).toBe(MAX_GROUP_LAUNCH);
  });

  // A palette entry is one Enter away from a second Enter, and a second press is a double-click
  // rather than a second intention. `AskRunner` makes the same call (D48).
  it('refuses a second press while one is in flight, and starts nothing twice', async () => {
    const { groups, launcher } = build([presetOf()]);
    launcher.gate.release = (): void => {
      // Held until the test releases it.
    };
    const first = groups.launch('morning');

    expect(await groups.launch('morning')).toEqual(err('busy'));
    expect(groups.inFlight).toBe(true);

    launcher.gate.release();
    await first;
    expect(launcher.asked.length).toBe(1);
  });

  it('lets go of the guard once the press is done, so the button is not wedged', async () => {
    const { groups } = build([presetOf()]);

    await groups.launch('morning');

    expect(groups.inFlight).toBe(false);
    expect((await groups.launch('morning')).ok).toBe(true);
  });
});

describe('GroupLauncher — what it reports', () => {
  it('names each preset and the session it started', async () => {
    const { groups, launcher } = build([presetOf({ name: 'ticket', sessionName: 'fd-ticket' })]);
    launcher.willAnswer('fd-ticket', ok('337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f'));

    const launched = await groups.launch('morning');

    expect(launched.ok && launched.value).toEqual({
      group: 'morning',
      outcomes: [
        {
          presetId: 'ticket',
          name: 'ticket',
          sessionId: '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
          failure: undefined,
        },
      ],
    });
  });

  /**
   * One preset failing must not take the others with it.
   *
   * This is the shape a real morning fails in: three presets, one naming a worktree that was
   * deleted last night. Two sessions started and the owner needs to know which one did not.
   */
  it('reports a partial failure as a partial success, not as a refusal', async () => {
    const { groups, launcher } = build([
      presetOf({ id: 'a', name: 'orchestrator', sessionName: 'fd-a' }),
      presetOf({ id: 'b', name: 'ticket', sessionName: 'fd-b' }),
      presetOf({ id: 'c', name: 'reports', sessionName: 'fd-c' }),
    ]);
    launcher.willAnswer('fd-b', err('launch_failed'));

    const launched = await groups.launch('morning');

    expect(launched.ok).toBe(true);
    // Named rather than positional, because the order is `byProjectThenName` and the point of this
    // case is WHICH preset failed, not where it landed.
    expect(launched.ok && failuresByName(launched.value)).toEqual({
      orchestrator: undefined,
      reports: undefined,
      ticket: 'launch_failed',
    });
  });

  // The press WAS accepted. "Core would not take this" and "core took it and nothing started" are
  // different sentences, and only the second one means the machine is broken.
  it('reports every launch failing as an accepted press, not a refused one', async () => {
    const { groups, launcher } = build([presetOf({ sessionName: 'fd-a' })]);
    launcher.willAnswerAll(err('no_shell'));

    const launched = await groups.launch('morning');

    expect(launched.ok).toBe(true);
    expect(launched.ok && launched.value.outcomes[0]?.failure).toBe('no_shell');
  });

  /**
   * The report's order is the GROUP's — `byProjectThenName`, the same order the presets panel
   * lists them in — and not the order the launches happened to finish in.
   *
   * It matters only for reading, because the launches are concurrent: what this pins is that a
   * press reported beside the palette entry that produced it lists the same names in the same
   * order every time, rather than reshuffling by whichever PowerShell returned first.
   */
  it('keeps the group order even when the presets are given out of order', async () => {
    const { groups } = build([
      presetOf({ id: 'z', name: 'zulu', sessionName: 'fd-z' }),
      presetOf({ id: 'a', name: 'alpha', sessionName: 'fd-a' }),
    ]);

    const launched = await groups.launch('morning');

    expect(launched.ok && launched.value.outcomes.map((one) => one.name)).toEqual([
      'alpha',
      'zulu',
    ]);
  });

  /**
   * Concurrent, and this is the case that says so.
   *
   * Sequentially, N presets is N × `LAUNCH_TIMEOUT_MS` in the worst case — four minutes of a held
   * request for a group of four. Concurrently the worst case is ONE timeout however large the
   * group is, which is what makes a single request honest.
   */
  it('starts them all at once rather than waiting for each to finish', async () => {
    const { groups, launcher } = build([
      presetOf({ id: 'a', sessionName: 'fd-a' }),
      presetOf({ id: 'b', sessionName: 'fd-b' }),
      presetOf({ id: 'c', sessionName: 'fd-c' }),
    ]);
    launcher.gate.release = (): void => {
      // Every launch is held here until released, so all three must be in flight to get past it.
    };

    const pressed = groups.launch('morning');
    await Promise.resolve();
    await Promise.resolve();
    // All three were asked before ANY of them answered — which a sequential loop cannot do.
    expect(launcher.asked.length).toBe(3);

    launcher.gate.release();
    expect((await pressed).ok).toBe(true);
  });
});

/** Outcomes keyed by preset name, so a case can name the one it cares about. */
function failuresByName(report: GroupLaunchReport): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(report.outcomes.map((one) => [one.name, one.failure]));
}
