// The P1-T7 probe, against files it makes itself — the probe is the thing `doctor` will reuse.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findTranscripts, readWhole } from '../../scripts/transcript-probe.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fd-probe-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function transcript(slug: string, name: string, lines: readonly string[]): string {
  mkdirSync(join(root, slug), { recursive: true });
  const path = join(root, slug, name);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

describe('readWhole', () => {
  it('reads a transcript to the end and folds it', async () => {
    const path = transcript('slug', 'a.jsonl', [
      '{"type":"custom-title","customTitle":"the thing","sessionId":"s"}',
      '{"type":"user"}',
      '{"type":"system","subtype":"away_summary","content":"a recap"}',
    ]);

    const reading = await readWhole(path);

    expect(reading.records).toBe(2);
    expect(reading.ignored).toBe(1);
    expect(reading.unknown).toBe(0);
    expect(reading.digest.custom).toBe(true);
    expect(reading.digest.away).toBe('a recap'.length);
  });

  it('reports a record type it has never seen, which is the number the probe exists for', async () => {
    const path = transcript('slug', 'a.jsonl', ['{"type":"invented-later"}']);

    const reading = await readWhole(path);

    expect(reading.unknown).toBe(1);
  });

  it('prints lengths and never the text itself', async () => {
    const path = transcript('slug', 'a.jsonl', [
      '{"type":"last-prompt","lastPrompt":"something private","sessionId":"s"}',
    ]);

    const reading = await readWhole(path);

    // The corpus this runs against is the owner's real work (SEC-DATA-1), so the output has to be
    // safe to paste into a PR — which means it cannot contain a prompt.
    expect(JSON.stringify(reading)).not.toContain('something private');
    expect(reading.digest.prompt).toBe('something private'.length);
  });

  it('says nothing was read rather than throwing on a file that is not there', async () => {
    const reading = await readWhole(join(root, 'missing.jsonl'));

    expect(reading.bytes).toBe(0);
    expect(reading.records).toBe(0);
  });
});

describe('findTranscripts', () => {
  it('finds every .jsonl under every slug, largest first', () => {
    transcript('one', 'small.jsonl', ['{"type":"user"}']);
    transcript(
      'two',
      'big.jsonl',
      Array.from({ length: 50 }, () => '{"type":"user"}'),
    );
    transcript('two', 'notes.txt', ['ignored']);

    const found = findTranscripts([root]);

    expect(found).toHaveLength(2);
    expect(found[0]?.endsWith('big.jsonl')).toBe(true);
  });

  it('skips a root that does not exist rather than failing the run', () => {
    expect(findTranscripts([join(root, 'nope')])).toEqual([]);
  });
});
