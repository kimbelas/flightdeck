// `POST /sessions/handoff` — P6-T6.
//
// The body is the only one among the session verbs that names a FOLDER, so the screening half is
// what this file is mostly about. The route does not decide whether the folder may be used —
// `ProjectRegistry.resolveDirectory` does — but it does decide what is even shaped like a request,
// and everything it lets through reaches a process.
import { describe, expect, it } from 'vitest';
import type { HandoffFailure } from '../../../contracts/launch-reply.ts';
import { HandoffRoute, type SessionForker } from '../../../core/http/handoff-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';

const SESSION = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const FACTS = { url: new URL('http://127.0.0.1:4950/sessions/handoff') } as unknown as RequestFacts;

type Asked = Parameters<SessionForker['handOff']>[0];

class StubForker {
  public readonly asked: Asked[] = [];
  private answer: Result<string, HandoffFailure> = ok('b4977dd3');

  public willAnswer(answer: Result<string, HandoffFailure>): void {
    this.answer = answer;
  }

  public handOff(request: Asked): Promise<Result<string, HandoffFailure>> {
    this.asked.push(request);
    return Promise.resolve(this.answer);
  }
}

function build(): { route: HandoffRoute; forker: StubForker } {
  const forker = new StubForker();
  return { route: new HandoffRoute(forker), forker };
}

function bodyOf(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: SESSION,
    shortId: '337975f9',
    subscription: '365',
    cwd: 'C:\\repo\\.claude\\worktrees\\spike',
    name: 'spike',
    ...over,
  });
}

describe('HandoffRoute', () => {
  it('is a POST on its own literal path, beside the other session verbs', () => {
    const { route } = build();

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/sessions/handoff');
  });

  /**
   * 201, not 200 — and the difference is the whole of what separates this from a resume.
   *
   * A resume answers 200 because a session changed state. A handoff CREATES one, and the id in the
   * reply is a session that did not exist a second ago.
   */
  it('answers 201 with the NEW session id', async () => {
    const { route } = build();

    const reply = await route.handle(FACTS, bodyOf());

    expect(reply).toEqual({ status: 201, body: { sessionId: 'b4977dd3' } });
  });

  it('passes the folder and the name through', async () => {
    const { route, forker } = build();

    await route.handle(FACTS, bodyOf());

    expect(forker.asked[0]).toEqual({
      subscription: '365',
      sessionId: SESSION,
      cwd: 'C:\\repo\\.claude\\worktrees\\spike',
      name: 'spike',
    });
  });

  it('trims the name, so a trailing space is not a different session', async () => {
    const { route, forker } = build();

    await route.handle(FACTS, bodyOf({ name: '  spike  ' }));

    expect(forker.asked[0]?.name).toBe('spike');
  });

  // `no_claude` is the operator's problem rather than the request's, exactly as a launch's is.
  it('answers 503 when Claude Code is not installed', async () => {
    const { route, forker } = build();
    forker.willAnswer(err('no_claude'));

    expect((await route.handle(FACTS, bodyOf())).status).toBe(503);
  });

  it.each([
    { failure: 'bad_session' as const, why: 'an id that would fork something else' },
    { failure: 'bad_cwd' as const, why: 'a folder outside every project' },
    { failure: 'bad_name' as const, why: 'a name it will not take' },
    { failure: 'handoff_failed' as const, why: 'a fork that failed' },
    { failure: 'no_session_id' as const, why: 'an answer it could not read' },
  ])('answers 400 for $why', async ({ failure }) => {
    const { route, forker } = build();
    forker.willAnswer(err(failure));

    expect(await route.handle(FACTS, bodyOf())).toEqual({ status: 400, body: { error: failure } });
  });

  it.each([
    { body: '{', why: 'a body that is not JSON at all' },
    { body: '"handoff"', why: 'a body that is not an object' },
    { body: bodyOf({ sessionId: '337975f9' }), why: 'a short id where the full one belongs' },
    { body: bodyOf({ subscription: 'personal' }), why: 'a subscription nobody has' },
    { body: bodyOf({ cwd: '' }), why: 'an empty folder' },
    { body: bodyOf({ cwd: 7 }), why: 'a folder that is not a string' },
    { body: bodyOf({ cwd: `C:\\${'a'.repeat(400)}` }), why: 'a folder past the cap' },
    { body: bodyOf({ name: '   ' }), why: 'a name that is only whitespace' },
    { body: bodyOf({ name: 'a'.repeat(81) }), why: 'a name past the cap' },
    { body: JSON.stringify({ sessionId: SESSION, subscription: '365' }), why: 'no folder or name' },
  ])('refuses $why without reaching the forker', async ({ body }) => {
    const { route, forker } = build();

    const reply = await route.handle(FACTS, body);

    expect(reply.status).toBe(400);
    expect(forker.asked).toEqual([]);
  });
});
