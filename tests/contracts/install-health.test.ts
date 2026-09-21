// `claude doctor` and `claude update`, narrowed — P4-T5.
//
// Both fixtures below are the REAL output, measured on this machine (RESEARCH.md F.10.1, F.10.2).
// Two of the assertions are the task:
//
//  - doctor's `Path:` line carries the Windows account name, and must not survive the parse
//    (SEC-DATA-2) — the same control `contracts/core-status.ts` already applies to
//    `transcriptPath`;
//  - update's stdout is NOT only its own, because `update` runs a session lifecycle and fires the
//    `SessionEnd` hook, so with core down it carries a Flightdeck ECONNREFUSED line. A panel that
//    printed the output verbatim would show the owner an error Flightdeck caused, about
//    Flightdeck, looking like Claude being broken.
import { describe, expect, it } from 'vitest';
import {
  parseInstallHealth,
  parseInstallHealthReply,
  parseUpdateResult,
  HEALTH_KEYS,
  MAX_HEALTH_VALUE_CHARS,
} from '../../contracts/install-health.ts';

/** Verbatim from `claude doctor` on 2026-09-21, account name replaced. */
const DOCTOR = [
  'Claude Code doctor',
  '',
  'Running: npm-global (2.1.278)',
  'Commit: 809c980662e3',
  'Platform: win32-x64',
  'Path: C:\\Users\\ada\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
  'Config install method: global',
  'Search: OK (bundled)',
  'Auto-updates: enabled',
  'Auto-update channel: latest',
  'Last update attempt: success → 2.1.278 (2026-09-19)',
  'Managed settings (remote): none configured for this organization',
  'Organization policy: Loaded from api.anthropic.com',
  '',
  'No installation issues found.',
].join('\n');

/** Verbatim from `claude update`, including the line Flightdeck caused by being down (F.10.2). */
const UPDATE_CURRENT = [
  'Current version: 2.1.278',
  'Checking for updates to latest version...',
  'Claude Code is up to date (2.1.278)',
  'SessionEnd hook [http://127.0.0.1:4950/hooks] failed: connect ECONNREFUSED 127.0.0.1:4950',
].join('\n');

describe('parseInstallHealth — what it keeps', () => {
  it('reads the fields the chip asks about', () => {
    const health = parseInstallHealth('365', DOCTOR);
    const value = (key: string): string | undefined =>
      health.fields.find((field) => field.key === key)?.value;

    expect(value('Running')).toBe('npm-global (2.1.278)');
    expect(value('Platform')).toBe('win32-x64');
    expect(value('Auto-updates')).toBe('enabled');
    expect(value('Last update attempt')).toBe('success → 2.1.278 (2026-09-19)');
  });

  it('reports the installation as healthy when doctor said so', () => {
    expect(parseInstallHealth('365', DOCTOR).healthy).toBe(true);
  });

  it('says undefined rather than false when doctor said neither', () => {
    // "it did not say" and "it found problems" are different, and only one is worth a warning.
    expect(
      parseInstallHealth('365', 'Claude Code doctor\nRunning: npm-global (2.1.1)').healthy,
    ).toBe(undefined);
  });

  it('reads auto-updates, which is why the update button is a convenience', () => {
    // The roadmap asked for an update button on the assumption somebody has to press one. The
    // binary keeps itself current (F.10.1), so the panel says so instead of implying otherwise.
    expect(parseInstallHealth('365', DOCTOR).autoUpdates).toBe(true);
    expect(parseInstallHealth('365', DOCTOR.replace('enabled', 'disabled')).autoUpdates).toBe(
      false,
    );
  });
});

describe('parseInstallHealth — what it refuses to publish (SEC-DATA-2)', () => {
  it('drops the Path line, which carries the Windows account name', () => {
    // The whole reason this is a parser and not a `<pre>`.
    const health = parseInstallHealth('365', DOCTOR);

    expect(JSON.stringify(health)).not.toContain('ada');
    expect(JSON.stringify(health)).not.toContain('AppData');
    // Spelled against the published key list rather than by comparing to 'Path': the union does
    // not contain it, which is the control, so a direct comparison would not even typecheck.
    expect(HEALTH_KEYS.some((key) => key.includes('Path'))).toBe(false);
  });

  it('drops the two lines that name the employer', () => {
    const health = parseInstallHealth('365', DOCTOR);

    expect(JSON.stringify(health)).not.toContain('Managed settings');
    expect(JSON.stringify(health)).not.toContain('Organization policy');
  });

  it('drops a key a future version adds, rather than publishing it by default', () => {
    // Excluded by default is the control. A parser that kept unknown keys would publish whatever
    // the next release decided to print, which is how the Path line would come back.
    const health = parseInstallHealth('365', `${DOCTOR}\nSomething New: a value nobody vetted`);

    expect(JSON.stringify(health)).not.toContain('nobody vetted');
    expect(health.fields.every((field) => HEALTH_KEYS.includes(field.key))).toBe(true);
  });

  it('caps a value however long the line was', () => {
    const long = `Commit: ${'x'.repeat(400)}`;
    const health = parseInstallHealth('365', long);

    expect(health.fields[0]?.value).toHaveLength(MAX_HEALTH_VALUE_CHARS);
  });

  it('takes the first reading of a repeated key rather than the last', () => {
    const health = parseInstallHealth('365', 'Platform: win32-x64\nPlatform: something-else');

    expect(health.fields.filter((field) => field.key === 'Platform')).toHaveLength(1);
    expect(health.fields[0]?.value).toBe('win32-x64');
  });
});

describe('parseUpdateResult', () => {
  it('reads "already up to date" as no change, which is the ordinary answer', () => {
    // Auto-updates are on, so this is what the button says almost every time (F.10.1).
    const result = parseUpdateResult('365', UPDATE_CURRENT);

    expect(result.changed).toBe(false);
    expect(result.version).toBe('2.1.278');
  });

  it('never relays the hook error Flightdeck itself caused', () => {
    // `update` runs a session lifecycle and fires SessionEnd, so with core down its stdout carries
    // an ECONNREFUSED against 127.0.0.1:4950 — Flightdeck's own port. Printing it would tell the
    // owner Claude is broken when the thing that is down is the deck they are reading it on.
    const result = parseUpdateResult('365', UPDATE_CURRENT);

    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(result)).not.toContain('4950');
    expect(JSON.stringify(result)).not.toContain('hook');
  });

  it('reports a change when a new version was installed', () => {
    const result = parseUpdateResult(
      '365',
      'Current version: 2.1.278\nSuccessfully updated to 2.1.300 (2.1.300)',
    );

    expect(result.changed).toBe(true);
    expect(result.version).toBe('2.1.300');
  });
});

describe('parseInstallHealthReply — the deck side', () => {
  it('reads a reply it produced, and drops a key it does not know', () => {
    const wire = {
      subscription: '365',
      healthy: true,
      autoUpdates: true,
      fields: [
        { key: 'Platform', value: 'win32-x64' },
        { key: 'Path', value: 'C:\\Users\\ada\\claude.exe' },
      ],
    };
    const parsed = parseInstallHealthReply(wire);

    expect(parsed?.fields).toHaveLength(1);
    expect(parsed?.fields[0]?.key).toBe('Platform');
    expect(JSON.stringify(parsed)).not.toContain('ada');
  });

  it('refuses a body that names no subscription', () => {
    expect(parseInstallHealthReply({ fields: [] })).toBeUndefined();
    expect(parseInstallHealthReply('nope')).toBeUndefined();
  });
});
