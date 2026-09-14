// `GET /session` — the route that turns three query parameters into a filesystem read (P2-T4).
//
// A route whose parameters end up in a path deserves its own refusal tests, and they are most of
// this file. The 400s are not politeness: the deck composes this URL from a row it already has, so
// a malformed one is a bug or a probe, and the reply says nothing about which field was wrong
// (SECURITY.md §3 rule 3).
import { describe, expect, it } from 'vitest';
import { SessionDetailRoute, type DetailSource } from '../../../core/http/session-detail-route.ts';
import type { SessionDetail } from '../../../contracts/session-detail.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';
import { NO_EXTRAS } from '../../../contracts/session-detail.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';

/** Records what the route asked for, which is the only thing worth asserting about the join. */
class FakeReader implements DetailSource {
  public readonly asked: SessionRef[] = [];

  public read(ref: SessionRef): Promise<SessionDetail> {
    this.asked.push(ref);
    return Promise.resolve({
      sessionId: ref.sessionId,
      at: 1_789_000_100_000,
      job: undefined,
      timeline: [],
      vitals: undefined,
      extras: NO_EXTRAS,
      tokenTrail: [],
    });
  }
}

function rig(): { route: SessionDetailRoute; reader: FakeReader } {
  const reader = new FakeReader();
  return { route: new SessionDetailRoute(reader), reader };
}

function url(query: string): string {
  return `/session?${query}`;
}

const WHOLE = `session=${SESSION}&short=cb5e8102&subscription=365`;

describe('SessionDetailRoute', () => {
  it('is registered at a literal path, because the router has no parameters', () => {
    // BUILD-PLAN §4 sketches `/sessions/:id`; `RequestRouter` matches method and path literally so
    // that no handler is reachable by a path that merely starts like an allowed one. The id rides
    // the query instead, and the BUILD-PLAN row is a REST sketch rather than a promise about
    // punctuation.
    const { route } = rig();

    expect(route.path).toBe('/session');
    expect(route.method).toBe('GET');
  });

  it('is authenticated by the token, like every other control route', () => {
    expect(rig().route.credential).toBe('token');
    expect(rig().route.limit).toBe('control');
  });

  it('answers a whole reference with the detail', async () => {
    const { route, reader } = rig();

    const reply = await route.handle({ method: 'GET', url: url(WHOLE), headers: {} });

    expect(reply.status).toBe(200);
    expect(reader.asked[0]).toEqual({
      sessionId: SESSION,
      shortId: 'cb5e8102',
      subscription: '365',
    });
  });

  it('refuses a short id that could name anything but a job directory, without reading', async () => {
    // The assertion that matters: the reader must never be called, because calling it is what
    // composes a path. `contracts/session-ref.ts` owns the shape; this owns that it is applied.
    for (const short of ['..', '..%5C..%5Cdaemon', 'cb5e810', 'CB5E8102']) {
      const { route, reader } = rig();

      const reply = await route.handle({
        method: 'GET',
        url: url(`session=${SESSION}&short=${short}&subscription=365`),
        headers: {},
      });

      expect(reply.status).toBe(400);
      expect(reader.asked).toEqual([]);
    }
  });

  it('refuses a missing parameter, a bad subscription and no query at all', async () => {
    const { route } = rig();

    for (const query of [
      `session=${SESSION}&short=cb5e8102`,
      `session=${SESSION}&short=cb5e8102&subscription=personal`,
      'short=cb5e8102&subscription=365',
      '',
    ]) {
      expect((await route.handle({ method: 'GET', url: url(query), headers: {} })).status).toBe(
        400,
      );
    }
  });

  it('refuses a request with no url rather than throwing', async () => {
    const { route } = rig();

    const reply = await route.handle({ method: 'GET', url: undefined, headers: {} });

    expect(reply.status).toBe(400);
  });

  it('says nothing about which field was wrong', async () => {
    const { route } = rig();

    const reply = await route.handle({ method: 'GET', url: url('short=..'), headers: {} });

    expect(reply.body).toEqual({ error: 'bad_request' });
  });
});
