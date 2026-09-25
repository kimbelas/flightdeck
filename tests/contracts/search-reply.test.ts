// `GET /search`'s whole body, and the one question the deck asks of it first — P7-T2.
import { describe, expect, it } from 'vitest';
import {
  isFilling,
  NOT_YET_INDEXED,
  parseIndexProgress,
  parseSearchReply,
  type IndexProgress,
} from '../../contracts/search-reply.ts';

const DONE: IndexProgress = {
  passedAt: 1000,
  transcripts: 10,
  behind: 0,
  bytesTotal: 500,
  bytesIndexed: 500,
};

const HIT = {
  subscription: '365',
  sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
  projectKey: 'C--work',
  kind: 'you',
  at: 5,
  snippet: 'deploy',
};

describe('parseSearchReply', () => {
  it('reads the hits and the progress', () => {
    expect(parseSearchReply({ hits: [HIT], index: DONE })).toEqual({ hits: [HIT], index: DONE });
  });

  // A P7-T1 core answers `{ hits }` alone. That is "unknown", which the deck must not draw as done.
  it('reads a reply with no progress as unknown, not as caught up', () => {
    expect(parseSearchReply({ hits: [] }).index).toBeUndefined();
  });

  it('drops a hit it cannot read and keeps the rest', () => {
    expect(parseSearchReply({ hits: [HIT, { sessionId: 3 }] }).hits).toEqual([HIT]);
  });

  it.each([undefined, null, 'x', []])('reads %s as nothing at all', (body) => {
    expect(parseSearchReply(body)).toEqual({ hits: [], index: undefined });
  });
});

describe('parseIndexProgress', () => {
  it('reads a core that has not finished its first pass', () => {
    const { passedAt, ...counts } = NOT_YET_INDEXED;

    expect(passedAt).toBeUndefined();
    expect(parseIndexProgress(counts)).toEqual(NOT_YET_INDEXED);
  });

  it('never reports more indexed than there is', () => {
    expect(parseIndexProgress({ ...DONE, bytesIndexed: 900 })?.bytesIndexed).toBe(500);
  });

  it.each([
    { ...DONE, behind: -1 },
    { ...DONE, transcripts: 1.5 },
    { ...DONE, bytesTotal: '500' },
    { ...DONE, bytesIndexed: undefined },
    { ...DONE, passedAt: 'yesterday' },
  ])('refuses %o', (value) => {
    expect(parseIndexProgress(value)).toBeUndefined();
  });
});

describe('isFilling', () => {
  it('is filling before the first pass has finished', () => {
    expect(isFilling(NOT_YET_INDEXED)).toBe(true);
  });

  it('is filling while any transcript is behind', () => {
    expect(isFilling({ ...DONE, behind: 3 })).toBe(true);
  });

  it('is not filling once every cursor has reached its file', () => {
    expect(isFilling(DONE)).toBe(false);
  });
});
