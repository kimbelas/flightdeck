// The line-log half of the scrubber — P7-T4, DECISIONS.md D60.
//
// Its own file for `capture-frames.test.ts`'s reason: the rule is neither the JSON one (keep the
// shape) nor the frame one (keep the length, never read the words). A log keeps its WORDS, because
// they are the vocabulary the parser reads, and rewrites only the two slot kinds that can carry
// identity — and anything it has no template for stops the capture.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper script, no type declarations by design.
import { scrub } from '../scripts/capture-fixtures.mjs';
// @ts-expect-error -- plain ESM helper script, no type declarations by design.
import { scrubLog } from '../scripts/capture-log.mjs';

interface Rules {
  readonly instant: (value: string) => string;
  readonly path: (value: string) => string;
  readonly id: (value: string) => string;
}

const scrubLine = scrubLog as (raw: string, rules: Rules) => string;
const scrubValue = scrub as (node: unknown, key?: string) => unknown;

const RULES: Rules = {
  instant: () => '2020-01-01T00:00:00.000Z',
  path: () => 'C:\\Users\\path-000000\\x.exe',
  id: (value) => `id${value.slice(0, 6)}`.replaceAll(/[^0-9a-z]/gu, '0'),
};

const AT = '[2026-09-10T20:34:48.927Z]';

describe('capture-log scrubLog', () => {
  it('keeps the vocabulary the parser reads and rewrites the short id in place', () => {
    const out = scrubLine(
      `${AT} [bg] bg retire a41e908d: idle-prompt, idle 32m [low memory]`,
      RULES,
    );

    expect(out).toBe(
      '[2020-01-01T00:00:00.000Z] [bg] bg retire ida41e90: idle-prompt, idle 32m [low memory]',
    );
  });

  it('rewrites a path through the path rule and keeps the words around it', () => {
    const out = scrubLine(
      `${AT} [supervisor] binary at C:\\Users\\someone\\bin\\claude.exe changed (mtime changed) — self-restarting for upgrade`,
      RULES,
    );

    expect(out).not.toContain('someone');
    expect(out).toContain('binary at C:\\Users\\path-000000\\x.exe changed');
  });

  it('keeps pids, versions and counts, which are the join the roster shares (F.2.16)', () => {
    const line = `${AT} [supervisor] ─── daemon start ─── version=2.1.268 pid=23140 origin=transient`;

    expect(scrubLine(line, RULES)).toContain('version=2.1.268 pid=23140 origin=transient');
  });

  it('keeps blank lines and the trailing newline', () => {
    expect(scrubLine(`${AT} [supervisor] workers=0\n\n`, RULES)).toBe(
      '[2020-01-01T00:00:00.000Z] [supervisor] workers=0\n\n',
    );
  });

  it('fails the capture on a line no template describes, naming the line', () => {
    const raw = `${AT} [supervisor] workers=0\n${AT} [bg] bg dispatched "fix the billing module"`;

    expect(() => scrubLine(raw, RULES)).toThrow(/line 2 matches no template/u);
  });

  it('fails on a line that is not [instant] [channel] message at all', () => {
    expect(() => scrubLine('free text somebody pasted', RULES)).toThrow(/line 1/u);
  });

  // The pipe's id is printed as `*` by Claude Code, and the template requires the star.
  it('fails if the control pipe were ever printed with its real name', () => {
    expect(() =>
      scrubLine(
        `${AT} [bg] bg: control socket bound at \\\\.\\pipe\\cc-daemon-1a2b-control`,
        RULES,
      ),
    ).toThrow(/matches no template/u);
  });
});

describe('capture-fixtures keys for scheduled_task_fire (P7-T4)', () => {
  it('treats a loop prompt as free text however short it is', () => {
    const result = scrubValue({ prompt: 'ping me' }) as { prompt: string };

    expect(result.prompt).toMatch(/^text-[0-9a-f]{8}$/u);
  });

  it('keeps a cron readable even past the length rule, and the kind words', () => {
    const fire = { cron: '*/5 9-17 * * 1-5', taskKind: 'loop', cronKind: 'loop' };

    expect(scrubValue(fire)).toEqual(fire);
  });
});
