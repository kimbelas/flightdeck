// `POST /sessions/takeover` — P6-T8, D63.
//
// The body is a ref and nothing else. This is the one route that ends a process core did not
// start, so what it must not do above all is let a pid or a folder in through a field nobody
// screens: core reads both off the listing itself (`SessionTakeover`).
import { describe, expect, it } from 'vitest';
import type { TakeoverFailure } from '../../../contracts/launch-reply.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { TakeoverRoute, type SessionTakeoverPort } from '../../../core/http/takeover-route.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';

const SESSION = 'e3cd988e-4179-4ba5-9bed-69dbac7c6e93';
const FACTS = {
  url: new URL('http://127.0.0.1:4950/sessions/takeover'),
} as unknown as RequestFacts;

type Asked = Parameters<SessionTakeoverPort['takeOver']>[0];

class StubTakeover {
  public readonly asked: Asked[] = [];
  private answer: Result<string, TakeoverFailure> = ok(SESSION);

  public willAnswer(answer: Result<string, TakeoverFailure>): void {
    this.answer = answer;
  }

  public takeOver(request: Asked): Promise<Result<string, TakeoverFailure>> {
    this.asked.push(request);
    return Promise.resolve(this.answer);
  }
}

function build(): { route: TakeoverRoute; takeover: StubTakeover } {
  const takeover = new StubTakeover();
  return { route: new TakeoverRoute(takeover), takeover };
}

function bodyOf(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ sessionId: SESSION, shortId: 'e3cd988e', subscription: '365', ...over });
}

describe('TakeoverRoute', () => {
  it('is a POST on its own literal path, behind the token and the control budget', () => {
    const { route } = build();

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/sessions/takeover');
    expect(route.credential).toBe('token');
    expect(route.limit).toBe('control');
  });

  it('answers 200 and the same id', async () => {
    const { route } = build();

    const reply = await route.handle(FACTS, bodyOf());

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ sessionId: SESSION });
  });

  // The control: a pid or a folder on the body goes nowhere, because the port has no field for it.
  it('passes the subscription and the full id, and nothing else from the body', async () => {
    const { route, takeover } = build();

    await route.handle(FACTS, bodyOf({ pid: 4, cwd: 'C:\\Windows' }));

    expect(takeover.asked).toEqual([{ subscription: '365', sessionId: SESSION }]);
  });

  it.each(['not json', '{}', JSON.stringify({ sessionId: SESSION, subscription: 'nope' })])(
    'answers 400 to a body that is not a ref (%s), without asking',
    async (body) => {
      const { route, takeover } = build();

      const reply = await route.handle(FACTS, body);

      expect(reply.status).toBe(400);
      expect(takeover.asked).toEqual([]);
    },
  );

  it.each([
    { failure: 'busy', status: 409 },
    { failure: 'no_claude', status: 503 },
    { failure: 'not_running', status: 400 },
    { failure: 'end_failed', status: 400 },
  ] as const)('answers $failure as $status', async ({ failure, status }) => {
    const { route, takeover } = build();
    takeover.willAnswer(err(failure));

    const reply = await route.handle(FACTS, bodyOf());

    expect(reply.status).toBe(status);
    expect(reply.body).toEqual({ error: failure });
  });
});
