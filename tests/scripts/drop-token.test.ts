// P1-T6. The stop script's half of "stopped", which a forced kill cannot do itself.
//
// Worth a test rather than a look, because the failure is silent and expensive: a token file left
// behind with nothing listening costs every statusline render 51 ms instead of 0.10 ms, in every
// interactive session on the machine, until someone starts core again (RESEARCH.md F.3.3, G.12).
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = new URL('../../scripts/drop-token.ts', import.meta.url).href;

const originalOverride = process.env['FD_TOKEN_FILE'];

afterEach(() => {
  if (originalOverride === undefined) delete process.env['FD_TOKEN_FILE'];
  else process.env['FD_TOKEN_FILE'] = originalOverride;
});

/** A fresh import each time: the script does its work at module load, as a script should. */
async function runAgainst(path: string): Promise<void> {
  process.env['FD_TOKEN_FILE'] = path;
  await import(`${SCRIPT}?case=${String(Math.random())}`);
}

describe('drop-token', () => {
  it('removes the token file', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fd-drop-')), 'token');
    writeFileSync(path, 'a'.repeat(64), 'utf8');

    await runAgainst(path);

    expect(existsSync(path)).toBe(false);
  });

  it('is quiet when there is no token to remove', async () => {
    // Stopping something that is already stopped is the common case, not an error.
    const path = join(mkdtempSync(join(tmpdir(), 'fd-drop-')), 'token');

    await runAgainst(path);

    expect(existsSync(path)).toBe(false);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('reads the path from the one place that defines it', async () => {
    // The same override `contracts/core-token.ts` honours, which is what proxy.ts and core read.
    // A script that spelled the path itself would be a fourth definition of it.
    const path = join(mkdtempSync(join(tmpdir(), 'fd-drop-')), 'elsewhere.token');
    writeFileSync(path, 'token', 'utf8');

    await runAgainst(path);

    expect(existsSync(path)).toBe(false);
  });
});
