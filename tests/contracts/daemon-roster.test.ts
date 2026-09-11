// SECURITY.md SEC-FS-2 / DECISIONS.md D24 — the test that fails if a denied field ever reaches a
// parsed value. P1-T14 is specified to carry this; P0-T9 needed it first, because the capture
// script writes a fixture to disk and the projection is what keeps the secrets out of it.
//
// The denied values here are shaped like the real ones (32 hex characters of pipe auth, a
// dispatch block carrying prompt text) but are invented. A test for a secret-handling rule is the
// last place a real secret should appear.
import { describe, expect, it } from 'vitest';
import { projectRoster } from '../../contracts/daemon-roster.ts';
import roster from '../../fixtures/daemon/roster.json' with { type: 'json' };

const DENIED = ['rvAuth', 'ptyAuth', 'dispatch'];

const HOSTILE = {
  proto: 1,
  supervisorPid: 3828,
  updatedAt: 1789123114141,
  workers: {
    '020e5c73': {
      pid: 14572,
      sessionId: '020e5c73-aea4-45b5-9561-0ade34ac96fe',
      cwd: 'C:\\work\\project',
      startedAt: 1789123113696,
      cliVersion: '2.1.268',
      rvAuth: 'a'.repeat(32),
      ptyAuth: 'b'.repeat(32),
      dispatch: { launch: { args: ['--bg', 'refactor the billing module'] } },
    },
  },
};

describe('projectRoster', () => {
  it('keeps exactly the five allowlisted worker fields', () => {
    const worker = projectRoster(HOSTILE).workers['020e5c73'];
    expect(Object.keys(worker ?? {}).sort()).toEqual([
      'cliVersion',
      'cwd',
      'pid',
      'sessionId',
      'startedAt',
    ]);
  });

  it.each(DENIED)('never lets %s reach a parsed value', (field) => {
    expect(JSON.stringify(projectRoster(HOSTILE))).not.toContain(field);
  });

  it('drops the prompt text dispatch carries, not just the key', () => {
    expect(JSON.stringify(projectRoster(HOSTILE))).not.toContain('refactor the billing module');
  });

  it('is an allowlist, so a field invented by a future Claude Code release is dropped too', () => {
    const future = { workers: { a1b2c3d4: { pid: 1, brandNewSecret: 'c'.repeat(32) } } };
    expect(JSON.stringify(projectRoster(future))).not.toContain('brandNewSecret');
  });

  it('drops an allowlisted name whose value arrived as an object', () => {
    // `dispatch` is an object; so a name-only allowlist would copy through anything shaped like
    // one. The type check is the second half of the guarantee.
    const odd = { workers: { a1b2c3d4: { cwd: { secret: 'x'.repeat(32) } } } };
    expect(projectRoster(odd).workers['a1b2c3d4']?.cwd).toBeUndefined();
  });

  it('keeps supervisorPid — the dead-daemon signature P7-T4 needs (F.2.16)', () => {
    expect(projectRoster(HOSTILE).supervisorPid).toBe(3828);
  });

  it('yields an empty view for a torn read rather than throwing', () => {
    // The daemon rewrites this file while it runs, so a half-written read is ordinary.
    for (const bad of [null, undefined, 'not json', 42, []]) {
      expect(projectRoster(bad).workers).toEqual({});
    }
  });

  it('survives a worker that is not an object', () => {
    expect(projectRoster({ workers: { a1b2c3d4: 'gone' } }).workers).toEqual({});
  });
});

describe('the captured fixture', () => {
  it('carries no denied field', () => {
    for (const field of DENIED) expect(JSON.stringify(roster)).not.toContain(field);
  });

  it('keeps the worker key derivable from the scrubbed sessionId', () => {
    // Scrubbing the values while leaving the keys alone made the fixture assert a relationship it
    // no longer had, which is worse than not scrubbing it (P0-T9).
    for (const [id, worker] of Object.entries(roster.workers)) {
      expect(worker.sessionId.startsWith(id)).toBe(true);
    }
  });

  it('still parses as the shape P1-T14 will read', () => {
    const view = projectRoster(roster);
    expect(Object.keys(view.workers)).toHaveLength(1);
    expect(view.supervisorPid).toEqual(expect.any(Number));
  });
});
