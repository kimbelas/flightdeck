// What Connect writes into somebody's settings.json, pinned — because changing it silently is how
// a hooks block that no longer authenticates gets shipped (RESEARCH.md F.1.6).
import { describe, expect, it } from 'vitest';
import {
  CONNECTED_EVENTS,
  CORE_HOOKS_URL,
  HOOK_TIMEOUT_SECONDS,
  INGEST_KEY_ENV_VAR,
  connectRefusal,
  flightdeckHandler,
  parseConnectPlanReply,
  parseConnectWrite,
  refusedApplied,
} from '../../contracts/connect-plan.ts';

describe('the hooks block Connect writes', () => {
  it('posts to core’s hooks route on loopback', () => {
    expect(CORE_HOOKS_URL).toBe('http://127.0.0.1:4950/hooks');
  });

  it('carries the env var by NAME, never a literal secret', () => {
    const handler = flightdeckHandler();

    expect(handler.headers['Authorization']).toBe(`Bearer \${${INGEST_KEY_ENV_VAR}}`);
    expect(JSON.stringify(handler)).not.toMatch(/[0-9a-f]{32}/);
  });

  it('declares the variable in allowedEnvVars, without which it resolves to the empty string', () => {
    // Measured, not assumed: an undeclared name is interpolated to '' rather than left alone, so
    // omitting this is a 401 and not anything a reader would recognise (F.1.6).
    expect(flightdeckHandler().allowedEnvVars).toEqual([INGEST_KEY_ENV_VAR]);
  });

  it('times out in seconds, not the default minute', () => {
    expect(flightdeckHandler().timeout).toBe(HOOK_TIMEOUT_SECONDS);
    expect(HOOK_TIMEOUT_SECONDS).toBeLessThanOrEqual(5);
  });

  it('installs only events verified to arrive over http (F.1.6)', () => {
    expect([...CONNECTED_EVENTS]).toEqual([
      'UserPromptSubmit',
      'Notification',
      'Stop',
      'SubagentStop',
      'SessionEnd',
    ]);
  });

  it('never installs SessionStart, which the http transport does not carry (F.1.1)', () => {
    expect(CONNECTED_EVENTS).not.toContain('SessionStart');
  });

  it('never installs the per-tool-call events, which nothing reads yet', () => {
    expect(CONNECTED_EVENTS).not.toContain('PreToolUse');
    expect(CONNECTED_EVENTS).not.toContain('PostToolUse');
  });
});

/** A plan as `GET /connect` sends it. Whole files, because the diff is the deck's to render. */
const PLAN_BODY = {
  direction: 'connect',
  plan: {
    ok: true,
    changes: [{ path: 'C:/s.json', label: '365 · settings.json', before: '{}', after: '{"a":1}' }],
    alreadyDone: ['C:/statusline.py (already patched)'],
    environment: 'publish',
    environmentLabel: '$FLIGHTDECK_TOKEN (user environment)',
  },
};

describe('parseConnectPlanReply', () => {
  it('reads a plan the deck can render', () => {
    const plan = parseConnectPlanReply(PLAN_BODY);
    expect(plan).toEqual(PLAN_BODY.plan);
  });

  it('reads a refusal, which is a plan and not an error', () => {
    const body = { plan: { ok: false, refusals: [{ path: 'C:/s.json', reason: 'not JSON' }] } };
    expect(parseConnectPlanReply(body)).toEqual(body.plan);
  });

  it('drops the WHOLE plan when one change is unreadable, never the change alone', () => {
    const changes = [PLAN_BODY.plan.changes[0], { path: 'C:/b.json', label: 'b' }];
    expect(parseConnectPlanReply({ plan: { ...PLAN_BODY.plan, changes } })).toBeUndefined();
  });

  it('refuses an environment step it does not know, so the panel cannot print one', () => {
    const plan = { ...PLAN_BODY.plan, environment: 'delete-everything' };
    expect(parseConnectPlanReply({ plan })).toBeUndefined();
  });

  it('refuses anything that is not a plan at all', () => {
    for (const body of [undefined, null, 'ok', [], {}, { plan: { ok: 'yes' } }, { plan: [] }]) {
      expect(parseConnectPlanReply(body), JSON.stringify(body ?? null)).toBeUndefined();
    }
  });
});

describe('parseConnectWrite', () => {
  const WRITE = {
    direction: 'disconnect',
    applied: [{ path: 'C:/s.json', backup: 'C:/s.json.bak-1' }],
    environment: 'withdraw',
    environmentLabel: '$FLIGHTDECK_TOKEN (user environment)',
    alreadyDone: [],
  };

  it('reads what a write did, backups and all', () => {
    expect(parseConnectWrite(WRITE)).toEqual(WRITE);
  });

  it('refuses a body whose backups are not paths — the backup IS the recovery path', () => {
    expect(parseConnectWrite({ ...WRITE, applied: [{ path: 'C:/s.json' }] })).toBeUndefined();
  });

  it('refuses a direction outside the closed union', () => {
    expect(parseConnectWrite({ ...WRITE, direction: 'sideways' })).toBeUndefined();
  });
});

describe('a refused write', () => {
  const REFUSAL = {
    error: 'refused',
    reason: 'C:/b.json changed since the plan was made',
    applied: [{ path: 'C:/a.json', backup: 'C:/a.json.bak-1' }],
  };

  it('gives core’s own sentence rather than one the deck invents', () => {
    expect(connectRefusal(REFUSAL)).toBe(REFUSAL.reason);
    expect(connectRefusal({ error: 'refused' })).toBeUndefined();
    expect(connectRefusal({ reason: '' })).toBeUndefined();
  });

  it('still names the files it had already written, which is where the backups are', () => {
    expect(refusedApplied(REFUSAL)).toEqual(REFUSAL.applied);
  });

  it('is an empty list rather than a throw when there is nothing to recover', () => {
    for (const body of [undefined, {}, { applied: 'none' }, { applied: [{ path: 1 }] }]) {
      expect(refusedApplied(body)).toEqual([]);
    }
  });
});
