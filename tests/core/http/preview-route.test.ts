// `GET /preview` — P5a-T4.
//
// `SessionDetailRoute`'s tests, for the route that spawns a process instead of opening two files.
// The refusals matter more here, not less: `shortId` reaches a COMMAND LINE rather than a path, so
// a reference that is not one must never reach the reader — reaching it is what spawns.
import { describe, expect, it } from 'vitest';
import { PreviewRoute, type PreviewSource } from '../../../core/http/preview-route.ts';
import type { SessionPreview } from '../../../contracts/session-preview.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';
const WHOLE = `session=${SESSION}&short=cb5e8102&subscription=365`;

class FakeReader implements PreviewSource {
  public readonly asked: SessionRef[] = [];

  public read(ref: SessionRef): Promise<SessionPreview> {
    this.asked.push(ref);
    return Promise.resolve({
      sessionId: ref.sessionId,
      at: 1_789_000_100_000,
      source: 'logs',
      lines: ['a row'],
      reason: undefined,
    });
  }
}

function rig(): { route: PreviewRoute; reader: FakeReader } {
  const reader = new FakeReader();
  return { route: new PreviewRoute(reader), reader };
}

function url(query: string): string {
  return `/preview?${query}`;
}

describe('PreviewRoute', () => {
  it('is a literal path on the token, like every other control route', () => {
    const { route } = rig();

    expect(route.path).toBe('/preview');
    expect(route.method).toBe('GET');
    expect(route.credential).toBe('token');
    expect(route.limit).toBe('control');
  });

  it('is its OWN path, not a field on the detail — it costs a spawn (F.2.5)', () => {
    expect(rig().route.path).not.toBe('/session');
  });

  it('answers a whole reference with the preview', async () => {
    const { route, reader } = rig();

    const reply = await route.handle({ method: 'GET', url: url(WHOLE), headers: {} });

    expect(reply.status).toBe(200);
    expect(reader.asked[0]).toEqual({
      sessionId: SESSION,
      shortId: 'cb5e8102',
      subscription: '365',
    });
  });

  it('never reaches the reader with a short id that is not eight hex characters', async () => {
    // The reader is what runs `claude logs <shortId>`, so "the reader was not called" is the
    // assertion with teeth — a 400 whose reader had already spawned would be no refusal at all.
    for (const short of ['..', '..%5C..%5Cdaemon', 'cb5e810', 'CB5E8102', 'a b', '$(whoami)']) {
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
    const reply = await rig().route.handle({ method: 'GET', url: undefined, headers: {} });

    expect(reply.status).toBe(400);
  });

  it('says nothing about which field was wrong', async () => {
    const reply = await rig().route.handle({ method: 'GET', url: url('short=..'), headers: {} });

    expect(reply.body).toEqual({ error: 'bad_request' });
  });
});
