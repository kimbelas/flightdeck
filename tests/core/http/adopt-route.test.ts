// `POST /sessions/adopt` — P6-T7, SPEC §4.3.
//
// The body is a ref and nothing else, which is the half worth a file of its own: a handoff names a
// folder because only the owner knows which tree they want, and an adoption has exactly one right
// answer — the folder that terminal was working in, which core read off the machine itself. What
// this route must not do is let a folder in through a field nobody screens.
import { describe, expect, it } from 'vitest';
import type { AdoptFailure } from '../../../contracts/launch-reply.ts';
import { AdoptRoute, type SessionAdopterPort } from '../../../core/http/adopt-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';

const SESSION = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const FACTS = { url: new URL('http://127.0.0.1:4950/sessions/adopt') } as unknown as RequestFacts;

type Asked = Parameters<SessionAdopterPort['adopt']>[0];

class StubAdopter {
  public readonly asked: Asked[] = [];
  private answer: Result<string, AdoptFailure> = ok(SESSION);

  public willAnswer(answer: Result<string, AdoptFailure>): void {
    this.answer = answer;
  }

  public adopt(request: Asked): Promise<Result<string, AdoptFailure>> {
    this.asked.push(request);
    return Promise.resolve(this.answer);
  }
}

function build(): { route: AdoptRoute; adopter: StubAdopter } {
  const adopter = new StubAdopter();
  return { route: new AdoptRoute(adopter), adopter };
}

function bodyOf(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: SESSION,
    shortId: '337975f9',
    subscription: '365',
    ...over,
  });
}

describe('AdoptRoute', () => {
  it('is a POST on its own literal path, beside the other session verbs', () => {
    const { route } = build();

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/sessions/adopt');
  });

  it('is behind the token and the control budget, like every other verb', () => {
    const { route } = build();

    expect(route.credential).toBe('token');
    expect(route.limit).toBe('control');
  });

  /**
   * 200, not 201 — and the difference is the whole of what separates this from a handoff.
   *
   * An adoption does not create a session. It takes one that already exists and changes what kind
   * it is, and the id in the reply is the id that went in, which is the promise the argv makes.
   */
  it('answers 200 with the id it was given', async () => {
    const { route } = build();

    const reply = await route.handle(FACTS, bodyOf());

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ sessionId: SESSION });
  });

  it('passes the subscription and the full id through, and nothing else', async () => {
    const { route, adopter } = build();

    await route.handle(FACTS, bodyOf());

    expect(adopter.asked).toEqual([{ subscription: '365', sessionId: SESSION }]);
  });

  /**
   * The folder is core's, and a body that carried one must not reach the adopter.
   *
   * This is the assertion SEC-FS-1 is about on this route: a browser that could name the directory
   * a process starts in is the thing the whole session-verb family is shaped to prevent, and the
   * cheapest way for one to arrive would be an extra field that nobody strips.
   */
  it('ignores a folder somebody put in the body', async () => {
    const { route, adopter } = build();

    await route.handle(FACTS, bodyOf({ cwd: 'C:\\Windows\\System32' }));

    expect(adopter.asked[0]).not.toHaveProperty('cwd');
  });

  it.each([
    { body: '{', why: 'a body that is not JSON' },
    { body: '[]', why: 'a body that is a list' },
    { body: '{}', why: 'a body with no ref in it' },
    { body: bodyOf({ sessionId: '337975f9' }), why: 'a SHORT id, which would start a copy' },
    { body: bodyOf({ sessionId: SESSION.toUpperCase() }), why: 'an uppercase uuid' },
    { body: bodyOf({ subscription: 'other' }), why: 'a subscription nobody has' },
  ])('refuses $why without asking the adopter', async ({ body }) => {
    const { route, adopter } = build();

    const reply = await route.handle(FACTS, body);

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad_request' });
    expect(adopter.asked).toEqual([]);
  });

  /**
   * `no_claude` is the operator's problem, exactly as a launch's is.
   *
   * Reading a 503 as "core is not running" is precisely wrong here: core is running, it answered,
   * and it cannot find claude.exe — which is the one code worth a sentence of its own in the deck.
   */
  it('answers 503 when Claude Code could not be found', async () => {
    const { route, adopter } = build();
    adopter.willAnswer(err('no_claude'));

    const reply = await route.handle(FACTS, bodyOf());

    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: 'no_claude' });
  });

  // 400 rather than 404 for `not_adoptable`: the route was right and the session id is a real one,
  // core simply has nothing to adopt for it — most often because it restarted.
  it.each<AdoptFailure>(['bad_session', 'not_adoptable', 'still_running', 'adopt_failed'])(
    'answers 400 and core’s own code for %s',
    async (failure) => {
      const { route, adopter } = build();
      adopter.willAnswer(err(failure));

      const reply = await route.handle(FACTS, bodyOf());

      expect(reply.status).toBe(400);
      expect(reply.body).toEqual({ error: failure });
    },
  );
});
