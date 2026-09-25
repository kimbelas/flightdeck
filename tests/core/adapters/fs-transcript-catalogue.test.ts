// Walking for transcripts — P7-T1, SEC-FS-1.
//
// A real directory tree, because everything worth asserting here is about the filesystem: what is
// under `projects\<slug>\`, what is not a transcript, and what happens when a folder is not there
// at all. A machine with one subscription has no `.claude-isg\projects`, and a transcript is
// deleted after thirty days — an indexer that stopped because a file went away between two
// syscalls would stop for good.
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { FsTranscriptCatalogue } from '../../../core/adapters/node/fs-transcript-catalogue.ts';

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'flightdeck-catalogue-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const A = 'aaaaaaaa-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';

/** Writes one transcript under a subscription's `projects\<slug>\`. */
function write(
  dir: '.claude-365' | '.claude-isg',
  slug: string,
  name: string,
  text = '{}\n',
): string {
  const folder = join(home, dir, 'projects', slug);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, text);
  return path;
}

function catalogue(): FsTranscriptCatalogue {
  // `''` and not `undefined` for the executable: `ClaudeInstall` reads `undefined` as "go and look
  // on disk", and nothing here needs a binary — only the config directories.
  return new FsTranscriptCatalogue(new ClaudeInstall(home, ''));
}

describe('FsTranscriptCatalogue', () => {
  it('finds transcripts under both subscriptions', async () => {
    write('.claude-365', 'C--work', `${A}.jsonl`);
    write('.claude-isg', 'C--other', `${B}.jsonl`);

    const found = await catalogue().list();

    expect(found.map((entry) => entry.subscription).sort()).toEqual(['365', 'isg']);
  });

  it('carries the session id, the slug and the size, so the indexer needs no second read', async () => {
    write('.claude-365', 'C--work', `${A}.jsonl`, '{"type":"user"}\n');

    const [entry] = await catalogue().list();

    expect(entry).toMatchObject({
      subscription: '365',
      sessionId: A,
      projectKey: 'C--work',
      bytes: 16,
    });
  });

  /**
   * A transcript is named after its session, and that equality is what makes a hit clickable.
   *
   * A file called anything else in that folder is something else's, and inventing a session id for
   * it would put a row in the index that points nowhere.
   */
  it.each([
    'notes.md',
    'aaaaaaaa.jsonl',
    `${A}.json`,
    `${A.toUpperCase()}.jsonl`,
    'AAAAAAAA-0000-0000-0000-000000000000.jsonl',
  ])('leaves out %s, which is not a transcript', async (name) => {
    write('.claude-365', 'C--work', name);

    expect(await catalogue().list()).toEqual([]);
  });

  it('finds several slugs under one subscription', async () => {
    write('.claude-365', 'C--one', `${A}.jsonl`);
    write('.claude-365', 'C--two', `${B}.jsonl`);

    const found = await catalogue().list();

    expect(found.map((entry) => entry.projectKey).sort()).toEqual(['C--one', 'C--two']);
  });

  // Newest first, because that is the order somebody wants an index built in: a fresh store
  // catches up on this week before it catches up on March, so search works during the first pass.
  it('answers newest-written first', async () => {
    const older = write('.claude-365', 'C--work', `${A}.jsonl`);
    write('.claude-365', 'C--work', `${B}.jsonl`);
    const old = new Date(Date.now() - 86_400_000);
    utimesSync(older, old, old);

    const found = await catalogue().list();

    expect(found.map((entry) => entry.sessionId)).toEqual([B, A]);
  });

  // A machine with one subscription, which is an ordinary state rather than a failure.
  it('answers nothing for a subscription with no projects directory', async () => {
    write('.claude-365', 'C--work', `${A}.jsonl`);

    const found = await catalogue().list();

    expect(found).toHaveLength(1);
  });

  it('answers nothing at all when neither directory exists', async () => {
    expect(await catalogue().list()).toEqual([]);
  });

  it('ignores a file sitting directly in projects, outside any slug', async () => {
    mkdirSync(join(home, '.claude-365', 'projects'), { recursive: true });
    writeFileSync(join(home, '.claude-365', 'projects', `${A}.jsonl`), '{}');

    expect(await catalogue().list()).toEqual([]);
  });
});
