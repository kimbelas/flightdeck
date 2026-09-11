// SessionId — the short id and the uuid are one value, because the listing guarantees they agree
// (RESEARCH.md F.2.1, confirmed again on every roster worker in F.7.5).
import { describe, expect, it } from 'vitest';
import { SessionId } from '../../../core/domain/session-id.ts';

const UUID = '020e5c73-aea4-45b5-9561-0ade34ac96fe';

describe('SessionId', () => {
  it('derives the short id as the uuid first segment — no lookup table', () => {
    expect(SessionId.parse(UUID).short).toBe('020e5c73');
  });

  it('keeps the full uuid, which is the only form --resume accepts (F.2.7)', () => {
    expect(SessionId.parse(UUID).full).toBe(UUID);
  });

  it.each([
    ['', 'empty'],
    ['020e5c73', 'the short id alone'],
    ['020E5C73-AEA4-45B5-9561-0ADE34AC96FE', 'uppercase'],
    ['020e5c73-aea4-45b5-9561-0ade34ac96f', 'a digit short'],
    ['not-a-uuid-at-all', 'nonsense'],
  ])('refuses %s (%s)', (text) => {
    expect(() => SessionId.parse(text)).toThrow(/not a valid SessionId/);
  });

  it('refuses uppercase specifically, because a silent lowercase would fork a session', () => {
    // --resume anything-it-does-not-recognise starts a COPY under a new id (F.2.7), so a
    // forgiving parser loses the session it was asked to resume.
    expect(() => SessionId.parse(UUID.toUpperCase())).toThrow();
  });

  it('carries the failure code and no id content in the error details', () => {
    try {
      SessionId.parse('nope');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_value', details: { length: 4 } });
    }
  });

  it('matches the listing short id', () => {
    const id = SessionId.parse(UUID);
    expect(id.matchesShort('020e5c73')).toBe(true);
    expect(id.matchesShort('deadbeef')).toBe(false);
  });

  it('compares by value and prints the short form', () => {
    expect(SessionId.parse(UUID).equals(SessionId.parse(UUID))).toBe(true);
    expect(SessionId.parse(UUID).toString()).toBe('020e5c73');
  });
});
