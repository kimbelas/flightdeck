// What Connect writes into somebody's settings.json, pinned — because changing it silently is how
// a hooks block that no longer authenticates gets shipped (RESEARCH.md F.1.6).
import { describe, expect, it } from 'vitest';
import {
  CONNECTED_EVENTS,
  CORE_HOOKS_URL,
  HOOK_TIMEOUT_SECONDS,
  flightdeckHandler,
} from '../../contracts/connect-plan.ts';
import { INGEST_KEY_ENV_VAR } from '../../contracts/ingest-key.ts';

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
