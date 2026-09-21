// `POST /sessions/group` — P6-T4.
//
// Two things are worth a test here and the second is the one that matters. The body carries a NAME
// and nothing else, so everything a launch actually acts on — the folder, the profile function,
// the prompt — comes from presets core already screened; a body that could name a folder would be
// a way past SEC-FS-1 through a door nobody was watching.
//
// And the status codes say who has to do something: `409` means you already pressed it, `400`
// means the request is wrong, and `200` means the press was accepted — **including a press where
// every session failed to start**, which is a different sentence from "core would not take this".
import { describe, expect, it } from 'vitest';
import type { GroupLaunchReport, GroupRefusal } from '../../../contracts/preset-group.ts';
import { parseGroupLaunchReport } from '../../../contracts/preset-group.ts';
import { GroupLaunchRoute } from '../../../core/http/group-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';

const FACTS = { url: new URL('http://127.0.0.1:4950/sessions/group') } as unknown as RequestFacts;

const REPORT: GroupLaunchReport = {
  group: 'morning',
  outcomes: [
    { presetId: 'ticket', name: 'ticket', sessionId: 'a-session', failure: undefined },
    { presetId: 'orch', name: 'orchestrator', sessionId: undefined, failure: 'launch_failed' },
  ],
};

/** Records what it was asked, and answers whatever the test queued. */
class StubGroups {
  public readonly asked: string[] = [];
  private answer: Result<GroupLaunchReport, GroupRefusal> = ok(REPORT);

  public willAnswer(answer: Result<GroupLaunchReport, GroupRefusal>): void {
    this.answer = answer;
  }

  public launch(name: string): Promise<Result<GroupLaunchReport, GroupRefusal>> {
    this.asked.push(name);
    return Promise.resolve(this.answer);
  }
}

function build(): { route: GroupLaunchRoute; groups: StubGroups } {
  const groups = new StubGroups();
  return { route: new GroupLaunchRoute(groups), groups };
}

describe('GroupLaunchRoute', () => {
  it('is a POST on its own literal path, beside the other session verbs', () => {
    const { route } = build();

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/sessions/group');
  });

  it('passes the name through and answers with the report', async () => {
    const { route, groups } = build();

    const reply = await route.handle(FACTS, JSON.stringify({ group: 'morning' }));

    expect(groups.asked).toEqual(['morning']);
    expect(reply.status).toBe(200);
    // Through the parser the deck uses, rather than by reading the body core happened to build.
    expect(parseGroupLaunchReport(reply.body)).toEqual(REPORT);
  });

  it('trims the name, so a palette entry with a stray space still presses', async () => {
    const { route, groups } = build();

    await route.handle(FACTS, JSON.stringify({ group: '  morning  ' }));

    expect(groups.asked).toEqual(['morning']);
  });

  // The press WAS accepted. Only the report says nothing started.
  it('answers 200 for a press where every session failed', async () => {
    const { route, groups } = build();
    groups.willAnswer(
      ok({
        group: 'morning',
        outcomes: [{ presetId: 'a', name: 'a', sessionId: undefined, failure: 'no_shell' }],
      }),
    );

    const reply = await route.handle(FACTS, JSON.stringify({ group: 'morning' }));

    expect(reply.status).toBe(200);
    expect(parseGroupLaunchReport(reply.body)?.outcomes[0]?.failure).toBe('no_shell');
  });

  it('answers 409 for a second press while one is in flight', async () => {
    const { route, groups } = build();
    groups.willAnswer(err('busy'));

    const reply = await route.handle(FACTS, JSON.stringify({ group: 'morning' }));

    expect(reply).toEqual({ status: 409, body: { error: 'busy' } });
  });

  it.each([
    { refusal: 'unknown_group' as const, why: 'a group nobody has' },
    { refusal: 'too_many' as const, why: 'a group over the cap' },
  ])('answers 400 for $why', async ({ refusal }) => {
    const { route, groups } = build();
    groups.willAnswer(err(refusal));

    const reply = await route.handle(FACTS, JSON.stringify({ group: 'morning' }));

    expect(reply).toEqual({ status: 400, body: { error: refusal } });
  });

  it.each([
    { body: '{', why: 'a body that is not JSON at all' },
    { body: '"morning"', why: 'a body that is not an object' },
    { body: '[{"group":"morning"}]', why: 'an array' },
    { body: '{}', why: 'a body with no group in it' },
    { body: JSON.stringify({ group: '' }), why: 'an empty name' },
    { body: JSON.stringify({ group: '   ' }), why: 'a name that is only whitespace' },
    { body: JSON.stringify({ group: 7 }), why: 'a name that is not a string' },
    { body: JSON.stringify({ group: 'a'.repeat(61) }), why: 'a name past the cap' },
  ])('refuses $why without asking the launcher', async ({ body }) => {
    const { route, groups } = build();

    const reply = await route.handle(FACTS, body);

    expect(reply.status).toBe(400);
    expect(groups.asked).toEqual([]);
  });

  /**
   * The body carries a name and nothing else, and this is the case that says so.
   *
   * A folder, a profile function or a prompt smuggled into the body must reach nothing: everything
   * a launch acts on comes from presets `PresetBook` already screened on the way in (SEC-FS-1).
   */
  it('ignores anything else in the body — the launch reads presets, not the request', async () => {
    const { route, groups } = build();

    await route.handle(
      FACTS,
      JSON.stringify({
        group: 'morning',
        cwd: 'C:\\Windows\\System32',
        profileFn: 'claude-365',
        prompt: 'do something else',
        presets: [{ cwd: 'C:\\' }],
      }),
    );

    // One argument, and it is the name. There is nowhere else for the rest to have gone.
    expect(groups.asked).toEqual(['morning']);
  });
});
