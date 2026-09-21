// `.claude/gates.json`, read off the real one — P3-T6.
//
// The fixture below is `groundwork/.claude/gates.json` trimmed to its shape, the way
// `statusline-patcher.test.ts` keeps the shape of `statusline.py` it anchors on. It is another
// tool's format, so what is asserted here is what that tool actually writes rather than what this
// project would have found convenient: `stopChecks` and `verify` entries carry a `label` and
// `lint` entries do not, and **nothing anywhere in the file is a verdict**.
import { describe, expect, it } from 'vitest';
import {
  COACH_ORIGIN,
  coachPlanUrl,
  gatesOfKind,
  MAX_GATE_LABEL_CHARS,
  parseProjectGates,
  parseProjectGatesReply,
} from '../../contracts/project-gates.ts';

/** groundwork's, trimmed: two lint rules with no label, two stop checks and four verify steps. */
const REAL = {
  denyPaths: ['.next/**', 'node_modules/**', 'pnpm-lock.yaml', 'test-results/**'],
  askPaths: ['vault/**'],
  lint: [
    {
      match: '\\.(tsx|jsx|ts|css)$',
      exclude: 'node_modules/',
      command: 'node scripts/blueprint-lint.js',
    },
    {
      match: '\\.(ts|tsx|js|jsx|mjs)$',
      exclude: 'node_modules/',
      command: 'node scripts/fs-boundary.js',
    },
  ],
  stopChecks: [
    {
      match: '^(lib|app)[/\\\\]',
      command: 'pnpm exec vitest run',
      label: 'unit tests',
      timeoutMs: 180000,
    },
    {
      match: '\\.(ts|tsx)$',
      command: 'pnpm exec tsc --noEmit',
      label: 'typecheck',
      timeoutMs: 180000,
    },
  ],
  verify: [
    { command: 'pnpm exec tsc --noEmit', label: 'typecheck' },
    { command: 'pnpm exec eslint .', label: 'lint' },
    { command: 'pnpm exec vitest run', label: 'unit tests' },
    { command: 'pnpm exec playwright test', label: 'e2e' },
  ],
};

describe('parseProjectGates', () => {
  it('counts the path rules and names every gate, in the order they fire', () => {
    const gates = parseProjectGates(REAL);

    expect(gates).toEqual({
      denyPaths: 4,
      askPaths: 1,
      gates: [
        { kind: 'lint', label: 'node scripts/blueprint-lint.js' },
        { kind: 'lint', label: 'node scripts/fs-boundary.js' },
        { kind: 'stop', label: 'unit tests' },
        { kind: 'stop', label: 'typecheck' },
        { kind: 'verify', label: 'typecheck' },
        { kind: 'verify', label: 'lint' },
        { kind: 'verify', label: 'unit tests' },
        { kind: 'verify', label: 'e2e' },
      ],
    });
  });

  /**
   * The measurement this whole file exists for.
   *
   * SPEC §5.1(a) says to show `gates.json`'s verdict. There is no verdict in it — it defines the
   * gates and says nothing about whether they passed. Anything claiming otherwise would be this
   * project scoring a config, which D12 rules out.
   */
  it('finds nothing resembling a verdict, a score or a date in the real file', () => {
    expect(Object.keys(REAL).toSorted()).toEqual([
      'askPaths',
      'denyPaths',
      'lint',
      'stopChecks',
      'verify',
    ]);
  });

  it('prefers a gate’s own label and falls back to its command, which is how lint is named', () => {
    const gates = parseProjectGates({ lint: [{ command: 'a' }, { label: 'b', command: 'c' }] });
    expect(gates?.gates.map((gate) => gate.label)).toEqual(['a', 'b']);
  });

  it('caps a label where it is parsed, so one long command costs a line and not the panel', () => {
    const gates = parseProjectGates({ verify: [{ command: 'x'.repeat(400) }] });
    expect(gates?.gates[0]?.label.length).toBe(MAX_GATE_LABEL_CHARS);
  });

  it('drops a gate that names nothing rather than drawing an empty row', () => {
    const gates = parseProjectGates({ verify: [{ timeoutMs: 1 }, { command: '   ' }, {}] });
    expect(gates?.gates).toEqual([]);
  });

  it('reads a coached project that gates nothing as empty, which is not the same as absent', () => {
    expect(parseProjectGates({})).toEqual({ denyPaths: 0, askPaths: 0, gates: [] });
  });

  it('refuses anything that is not an object — absent means the project is not coached', () => {
    for (const value of [undefined, null, 'gates', 42, []]) {
      expect(parseProjectGates(value), JSON.stringify(value ?? null)).toBeUndefined();
    }
  });

  it('counts only path rules that are strings of a sane length', () => {
    const gates = parseProjectGates({ denyPaths: ['a', '', 7, 'b'.repeat(5000), 'c'] });
    expect(gates?.denyPaths).toBe(2);
  });
});

describe('parseProjectGatesReply', () => {
  it('round-trips what the reader put on the wire', () => {
    const gates = parseProjectGates(REAL);
    expect(parseProjectGatesReply(gates)).toEqual(gates);
  });

  it('drops a gate whose kind this build does not know rather than rendering it', () => {
    const reply = parseProjectGatesReply({
      denyPaths: 1,
      askPaths: 0,
      gates: [
        { kind: 'audit', label: 'x' },
        { kind: 'verify', label: 'y' },
      ],
    });
    expect(reply?.gates).toEqual([{ kind: 'verify', label: 'y' }]);
  });

  it('refuses a body with no counts, which is a body that is not one of these', () => {
    expect(parseProjectGatesReply({ gates: [] })).toBeUndefined();
    expect(parseProjectGatesReply(undefined)).toBeUndefined();
  });

  it('never answers a negative count, whatever arrives', () => {
    expect(parseProjectGatesReply({ denyPaths: -3, askPaths: 0, gates: [] })?.denyPaths).toBe(0);
  });
});

describe('where the verdict actually is', () => {
  it('links to coach, keyed by the project NAME, because that is what coach keys a plan by', () => {
    expect(coachPlanUrl('groundwork')).toBe(`${COACH_ORIGIN}/plans/groundwork`);
  });

  it('escapes a name rather than composing a URL out of it', () => {
    expect(coachPlanUrl('a b/../c')).toBe(`${COACH_ORIGIN}/plans/a%20b%2F..%2Fc`);
  });

  it('is loopback, like everything else this machine talks to', () => {
    expect(COACH_ORIGIN.startsWith('http://127.0.0.1:')).toBe(true);
  });
});

describe('gatesOfKind', () => {
  it('counts one kind, and zero is an answer', () => {
    const gates = parseProjectGates(REAL);
    expect(gates && gatesOfKind(gates, 'lint')).toBe(2);
    expect(gates && gatesOfKind(gates, 'stop')).toBe(2);
    expect(gates && gatesOfKind(gates, 'verify')).toBe(4);
    expect(
      parseProjectGates({}) && gatesOfKind({ denyPaths: 0, askPaths: 0, gates: [] }, 'lint'),
    ).toBe(0);
  });
});
