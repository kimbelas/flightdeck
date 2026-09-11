// Locks in the two background listing shapes measured in P0-T4 (RESEARCH.md F.2).
//
// P1-T3 parses this output for real. The shapes differ by whether the session is still live, and
// getting that wrong means either dropping live sessions or inventing pids for dead ones — so the
// difference is asserted here, against scrubbed captures, before the adapter exists.
import { describe, expect, it } from 'vitest';
import liveMixed from '../../fixtures/agents/live-mixed.json' with { type: 'json' };
import retired from '../../fixtures/agents/retired.json' with { type: 'json' };
import jobState from '../../fixtures/jobs/state.json' with { type: 'json' };
import jobBlocked from '../../fixtures/jobs/state-blocked.json' with { type: 'json' };

const LIVE_BACKGROUND_KEYS = [
  'pid',
  'id',
  'cwd',
  'kind',
  'startedAt',
  'sessionId',
  'name',
  'status',
  'state',
] as const;

const INTERACTIVE_KEYS = ['pid', 'cwd', 'kind', 'startedAt', 'sessionId', 'name', 'status'] as const;

const RETIRED_BACKGROUND_KEYS = [
  'id',
  'cwd',
  'kind',
  'startedAt',
  'sessionId',
  'name',
  'state',
] as const;

describe('claude agents --json', () => {
  it('gives a live background session both ids and both status fields', () => {
    const live = liveMixed.sessions.filter((s) => s.kind === 'background' && 'pid' in s);

    expect(live.length).toBeGreaterThan(0);
    for (const session of live) {
      expect(Object.keys(session).sort()).toEqual([...LIVE_BACKGROUND_KEYS].sort());
    }
  });

  it('gives an interactive session a pid and status but no id or state', () => {
    const interactive = liveMixed.sessions.filter((s) => s.kind === 'interactive');

    expect(interactive.length).toBeGreaterThan(0);
    for (const session of interactive) {
      expect(Object.keys(session).sort()).toEqual([...INTERACTIVE_KEYS].sort());
    }
  });

  it('drops pid and status once a background session is no longer live', () => {
    const dead = retired.sessions.filter((s) => s.kind === 'background' && !('pid' in s));

    expect(dead.length).toBeGreaterThan(0);
    for (const session of dead) {
      expect(Object.keys(session).sort()).toEqual([...RETIRED_BACKGROUND_KEYS].sort());
      // A stopped session and a daemon-retired one both land on `done` — the listing cannot
      // tell them apart, so nothing downstream may treat `done` as "finished successfully".
      expect(session.state).toBe('done');
    }
  });

  it('derives the short id from the first segment of the session uuid', () => {
    const background = retired.sessions.filter((s) => s.kind === 'background' && 'id' in s);

    expect(background.length).toBeGreaterThan(0);
    for (const session of background) {
      const shortId: unknown = (session as { id?: unknown }).id;
      expect(typeof shortId).toBe('string');
      expect(session.sessionId.startsWith(String(shortId))).toBe(true);
    }
  });

  it('never carries waitingFor, documented or not', () => {
    for (const session of [...liveMixed.sessions, ...retired.sessions]) {
      expect(session).not.toHaveProperty('waitingFor');
    }
  });
});

describe('jobs/<shortId>/state.json', () => {
  it('records the flags a resume replays, and pins the subscription', () => {
    expect(jobState.state_file.respawnFlags).toContain('-n');
    expect(jobState.state_file.providerEnv.CLAUDE_CONFIG_DIR).toMatch(/\.claude-/);
    expect(jobState.state_file.backend).toBe('daemon');
  });

  it('carries a needs sentence only while the session is blocked', () => {
    expect(jobBlocked.state_file.state).toBe('blocked');
    expect(typeof jobBlocked.state_file.needs).toBe('string');

    // On a settled session the key is absent entirely rather than null, so a schema for this file
    // makes `needs` optional, not nullable.
    expect(jobState.state_file.state).toBe('done');
    expect(Object.hasOwn(jobState.state_file, 'needs')).toBe(false);
  });
});
