// `GET /toasts/mutes` and `POST /toasts/mutes` — P6-T3.
//
// The screening half is what this file is mostly about. A mute body carries a session id and a
// subscription off a browser, and the parser refuses anything that is not the measured shape
// rather than cleaning it up — `session-ref.ts`'s rule, applied to the one verb that does not need
// a short id.
import { describe, expect, it } from 'vitest';
import { MuteBook } from '../../../core/application/mute-book.ts';
import { MutesReadRoute, MutesWriteRoute } from '../../../core/http/mutes-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const SESSION_ID = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const FACTS = { url: new URL('http://127.0.0.1:4950/toasts/mutes') } as unknown as RequestFacts;

function build(): { read: MutesReadRoute; write: MutesWriteRoute; book: MuteBook } {
  const book = new MuteBook({
    store: new FakeStore(),
    clock: new FakeClock(),
    logger: new FakeLogger(),
  });
  return { read: new MutesReadRoute(book), write: new MutesWriteRoute(book), book };
}

function bodyOf(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ sessionId: SESSION_ID, subscription: '365', muted: true, ...over });
}

describe('MutesReadRoute', () => {
  it('answers with the empty set before anything is muted', () => {
    const { read } = build();

    expect(read.handle()).toEqual({ status: 200, body: { muted: [] } });
  });

  it('answers with what is muted', () => {
    const { read, book } = build();
    book.set({ sessionId: SESSION_ID, subscription: '365' }, true);

    expect(read.handle().body).toEqual({ muted: [`365:${SESSION_ID}`] });
  });

  // Method and path are the table's business (routes.ts), and a GET that could write would be a
  // read the deck could not make freely. Both are pinned so neither can drift into the other.
  it('is a GET on its own literal path, and cannot write', () => {
    const { read, book } = build();

    read.handle();

    expect(read.method).toBe('GET');
    expect(read.path).toBe('/toasts/mutes');
    expect(book.keys()).toEqual([]);
  });
});

describe('MutesWriteRoute', () => {
  it('mutes a session and answers with the whole set', () => {
    const { write, book } = build();

    const reply = write.handle(FACTS, bodyOf());

    expect(reply).toEqual({ status: 200, body: { muted: [`365:${SESSION_ID}`] } });
    expect(book.isMuted({ sessionId: SESSION_ID, subscription: '365' })).toBe(true);
  });

  it('unmutes it again', () => {
    const { write, book } = build();
    write.handle(FACTS, bodyOf());

    const reply = write.handle(FACTS, bodyOf({ muted: false }));

    expect(reply.body).toEqual({ muted: [] });
    expect(book.isMuted({ sessionId: SESSION_ID, subscription: '365' })).toBe(false);
  });

  // 200 and not 201: a mute is a switch with two positions and setting it creates nothing.
  it('answers 200 for a mute that was already set, rather than creating a second one', () => {
    const { write } = build();
    write.handle(FACTS, bodyOf());

    const reply = write.handle(FACTS, bodyOf());

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ muted: [`365:${SESSION_ID}`] });
  });

  it.each([
    { body: '{', why: 'a body that is not JSON at all' },
    { body: '"muted"', why: 'a body that is not an object' },
    { body: bodyOf({ sessionId: '337975f9' }), why: 'a session id that is not a uuid' },
    { body: bodyOf({ sessionId: '..\\..\\daemon' }), why: 'a session id with a path in it' },
    { body: bodyOf({ subscription: 'personal' }), why: 'a subscription nobody has' },
    { body: JSON.stringify({ sessionId: SESSION_ID, muted: true }), why: 'a missing subscription' },
    { body: bodyOf({ muted: 'true' }), why: 'a mute that is a string' },
    { body: JSON.stringify({ sessionId: SESSION_ID, subscription: '365' }), why: 'a missing mute' },
  ])('refuses $why', ({ body }) => {
    const { write, book } = build();

    const reply = write.handle(FACTS, body);

    expect(reply.status).toBe(400);
    expect(book.keys()).toEqual([]);
  });
});
