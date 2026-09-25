// What the deck's logon task runs — P8-T1, SEC-NET-1, SEC-NET-2.
//
// The two promises are the address and the verb: `127.0.0.1`, because `next start` defaults to
// `0.0.0.0` and put the deck on the LAN once already (RESEARCH.md G.6); and `start`, never
// `build`, because a logon task has nobody to read a build failure.
import { describe, expect, it } from 'vitest';
import { LOOPBACK_ADDRESS, UI_PORT } from '../../contracts/origins.ts';
import { buildIdFile, deckLaunch } from '../../scripts/deck-launch.ts';

const REPO = 'C:\\dev\\flightdeck';

function launched(): { readonly args: readonly string[]; readonly env: Record<string, string> } {
  const launch = deckLaunch(REPO, true);
  if (!launch.ok) throw new Error(`expected a launch, got: ${launch.reason}`);
  return { args: launch.args, env: { ...launch.env } };
}

describe('deckLaunch', () => {
  it('serves on loopback and the fixed port', () => {
    const { args } = launched();

    expect(args[args.indexOf('-H') + 1]).toBe(LOOPBACK_ADDRESS);
    expect(args[args.indexOf('-p') + 1]).toBe(String(UI_PORT));
    expect(args).not.toContain('0.0.0.0');
  });

  it('starts, and never builds', () => {
    const { args } = launched();

    expect(args[1]).toBe('start');
    expect(args).not.toContain('build');
  });

  it("runs Next's own bin by path, so nothing at logon depends on PATH or npm", () => {
    expect(launched().args[0]).toMatch(/node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next$/);
  });

  it('turns telemetry off in the child (SEC-NET-2)', () => {
    expect(launched().env['NEXT_TELEMETRY_DISABLED']).toBe('1');
  });

  it('refuses without a build, and says what to run rather than looping', () => {
    const launch = deckLaunch(REPO, false);

    expect(launch.ok).toBe(false);
    expect(launch.ok ? '' : launch.reason).toContain('flightdeck.cmd');
  });
});

describe('buildIdFile', () => {
  it('is the file next start itself refuses to run without', () => {
    expect(buildIdFile(REPO)).toMatch(/\.next[\\/]BUILD_ID$/);
  });
});
