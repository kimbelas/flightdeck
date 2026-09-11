// The fake is only useful if it keeps the promise the port makes about ids.
//
// `since=` paging is the reason: a consumer that has seen 41 asks for everything after 41 and must
// not be able to miss 42. A fake that reused ids, or shared one counter between the two tables,
// would let a broken pager pass here and fail against sqlite.
import { describe, expect, it } from 'vitest';
import type { DraftAuditRow } from '../../contracts/audit-row.ts';
import type { DraftEvent } from '../../contracts/fd-event.ts';
import { FakeStore } from './fake-store.ts';

function event(sessionId: string, type: string): DraftEvent {
  return { at: 1000, sessionId, subscription: '365', source: 'reconcile', type, payload: {} };
}

function action(name: string): DraftAuditRow {
  return {
    at: 1000,
    who: 'token',
    action: name,
    target: 'session-a',
    args: ['--bg'],
    outcome: 'ok',
    reason: undefined,
  };
}

describe('FakeStore — event ids', () => {
  it('assigns monotonic, gapless ids starting at 1', () => {
    const store = new FakeStore();

    const ids = [1, 2, 3].map(() => store.appendEvent(event('a', 'seen')).id);

    expect(ids).toEqual([1, 2, 3]);
  });

  it('counts events and audit rows separately, so one does not consume the other ids', () => {
    const store = new FakeStore();

    const first = store.appendEvent(event('a', 'seen'));
    const audited = store.appendAudit(action('stop'));
    const second = store.appendEvent(event('a', 'gone'));

    expect([first.id, second.id]).toEqual([1, 2]);
    expect(audited.id).toBe(1);
  });

  it('returns the draft unchanged apart from the id', () => {
    const store = new FakeStore();
    const draft = event('a', 'seen');

    const stored = store.appendEvent(draft);

    expect(stored).toEqual({ ...draft, id: 1 });
  });
});

describe('FakeStore — paging', () => {
  it('returns only what follows `since`, oldest first', () => {
    const store = new FakeStore();
    for (const type of ['a', 'b', 'c']) store.appendEvent(event('s', type));

    const after = store.eventsSince(1, 10);

    expect(after.map((stored) => stored.type)).toEqual(['b', 'c']);
  });

  it('treats since 0 as from the beginning', () => {
    const store = new FakeStore();
    store.appendEvent(event('s', 'a'));

    expect(store.eventsSince(0, 10)).toHaveLength(1);
  });

  it('honours the limit', () => {
    const store = new FakeStore();
    for (const type of ['a', 'b', 'c']) store.appendEvent(event('s', type));

    expect(store.eventsSince(0, 2).map((stored) => stored.type)).toEqual(['a', 'b']);
  });

  it('narrows to one session without renumbering', () => {
    const store = new FakeStore();
    store.appendEvent(event('one', 'a'));
    store.appendEvent(event('two', 'b'));
    store.appendEvent(event('one', 'c'));

    const mine = store.eventsForSession('one', 0, 10);

    expect(mine.map((stored) => stored.id)).toEqual([1, 3]);
  });

  it('pages audit rows the same way', () => {
    const store = new FakeStore();
    for (const name of ['launch', 'stop']) store.appendAudit(action(name));

    expect(store.auditSince(1, 10).map((row) => row.action)).toEqual(['stop']);
  });
});

describe('FakeStore — failure', () => {
  it('throws on append once writes are broken, because a lost event is worse than a crash', () => {
    const store = new FakeStore();
    store.breakWrites();

    expect(() => store.appendEvent(event('a', 'seen'))).toThrow();
    expect(() => store.appendAudit(action('stop'))).toThrow();
  });

  it('collects the rows a reviewer looks for', () => {
    const store = new FakeStore();
    store.appendAudit(action('launch'));
    store.appendAudit({ ...action('stop'), outcome: 'refused', reason: 'not attachable' });

    expect(store.auditFailures().map((row) => row.action)).toEqual(['stop']);
  });
});
