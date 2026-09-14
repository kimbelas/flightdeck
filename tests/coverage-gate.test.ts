// Does the coverage gate actually bite? — P1-T13.
//
// The thresholds themselves are in `vitest.config.ts` and are checked by Vitest, which reads the
// coverage MAP. This file exists for the failure mode that reads as success: **a threshold that
// cannot fail**. A glob matching nothing, a folder renamed, a separator that does not match on
// this platform — each leaves a number in the config that every reviewer afterwards takes for a
// gate. It is the same shape as the scrubber's silent skip (P0-T9) and as the coverage table
// dropping rows it had listed on a smaller run (P1-T1, and this task's notes).
//
// So there are two assertions, and they are different questions:
//
//  1. **The mechanism works.** A deliberately uncovered file makes a real `vitest run --coverage`
//     exit non-zero, *and says why*. The "and says why" is load-bearing: the first version of this
//     probe wrote a config file into a temp directory outside the repo, where `vitest/config`
//     could not resolve — so the run exited 1 for the wrong reason and an exit-code-only assertion
//     passed while proving nothing. It now passes the whole configuration as CLI flags, needs no
//     config file, and asserts the threshold's own error line.
//
//  2. **This repo's globs match real files.** Cheap, structural, and the half that catches a
//     rename six months from now.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { COVERAGE_THRESHOLDS } from '../vitest.config.ts';

const REPO = join(import.meta.dirname, '..');
const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');

/** Everything Vitest measures, as the config's `coverage.include` prefixes. */
const MEASURED: readonly string[] = ['core', 'contracts', 'scripts'];

const temporary: string[] = [];

afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

/**
 * A two-file project: one covered by its test, one not covered at all.
 *
 * No config file, deliberately — see the header. The `--root` is outside the repo, so anything the
 * project itself had to import would not resolve, and a startup error is indistinguishable from a
 * threshold failure if all you check is the exit code.
 */
function probeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'flightdeck-gate-'));
  temporary.push(root);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'tests'));
  writeFileSync(
    join(root, 'src', 'covered.ts'),
    'export function one(): number {\n  return 1;\n}\n',
  );
  writeFileSync(
    join(root, 'src', 'uncovered.ts'),
    'export function two(): number {\n  const a = 2;\n  const b = a * 2;\n  return b * 2;\n}\n',
  );
  writeFileSync(
    join(root, 'tests', 'covered.test.ts'),
    [
      "import { expect, it } from 'vitest';",
      "import { one } from '../src/covered.ts';",
      "it('covers one', () => {",
      '  expect(one()).toBe(1);',
      '});',
      '',
    ].join('\n'),
  );
  return root;
}

interface Run {
  readonly status: number;
  readonly output: string;
}

function runVitest(root: string): Run {
  try {
    const output = execFileSync(
      process.execPath,
      [
        VITEST,
        'run',
        '--root',
        root,
        '--coverage',
        '--coverage.provider=v8',
        '--coverage.include=src/**/*.ts',
        '--coverage.reporter=text',
        '--coverage.thresholds.lines=90',
      ],
      // stderr piped rather than inherited, so the child's own threshold error does not land in
      // the middle of this suite's output and read as a failure of it.
      { encoding: 'utf8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, output };
  } catch (cause) {
    const failure: Readonly<Record<string, unknown>> =
      typeof cause === 'object' && cause !== null ? Object.fromEntries(Object.entries(cause)) : {};
    const status = failure['status'];
    return {
      status: typeof status === 'number' ? status : -1,
      output: `${textAt(failure, 'stdout')}${textAt(failure, 'stderr')}`,
    };
  }
}

describe('the coverage gate — a deliberately uncovered file fails the run', () => {
  const run = runVitest(probeProject());

  it('exits non-zero', () => {
    expect(run.status).toBe(1);
  });

  it('fails because of the threshold, and not because the probe was broken', () => {
    // The assertion that stops this test proving nothing: a startup error also exits 1.
    expect(run.output).toContain('ERROR: Coverage for lines');
    expect(run.output).toContain('does not meet global threshold (90%)');
  });

  it('ran the test it was given, so the run was real', () => {
    expect(run.output).toContain('1 passed');
  });
});

describe('the thresholds in vitest.config.ts are not vacuous', () => {
  const globs = Object.keys(COVERAGE_THRESHOLDS);

  it('names the three groups CODING-STANDARDS §10.1 does', () => {
    expect(globs).toEqual(['core/domain/**', 'core/**', 'contracts/**']);
  });

  for (const glob of globs) {
    it(`${glob} matches files that coverage.include measures`, () => {
      const prefix = glob.replace(/\/\*\*$/, '');
      const files = typescriptFilesUnder(join(REPO, prefix));

      // Not merely "more than nothing": a glob pointing at a directory that exists but holds one
      // file would also be a threshold nobody can fail.
      expect(files.length).toBeGreaterThan(3);
      expect(MEASURED).toContain(prefix.split('/')[0]);
    });
  }

  it('holds the domain to a higher bar than core at large, which is the point of two globs', () => {
    expect(COVERAGE_THRESHOLDS['core/domain/**'].lines).toBeGreaterThan(
      COVERAGE_THRESHOLDS['core/**'].lines,
    );
  });
});

/**
 * One captured stream off a failed `execFileSync`, as text.
 *
 * A field-by-field read rather than a template interpolation: `stdout` on that error is typed
 * loosely enough that stringifying it directly would happily print `[object Object]`, and an
 * assertion against `[object Object]` is exactly the kind that proves nothing.
 */
function textAt(failure: Readonly<Record<string, unknown>>, key: string): string {
  const value = failure[key];
  return typeof value === 'string' ? value : '';
}

/** Plain `readdirSync`, so this depends on no glob library of its own. */
function typescriptFilesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter((name) =>
    name.endsWith('.ts'),
  );
}
