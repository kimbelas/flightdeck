// SEC-ING-3 says the statusline change is additive. The load-bearing claim is that Disconnect
// puts the file back exactly as it was, so `remove(apply(x)) === x` is the test the whole
// control rests on — and it has to hold on CRLF, which is what statusline.py is on Windows.
import { describe, expect, it } from 'vitest';
import { StatuslinePatcher } from '../../scripts/statusline-patch.ts';

/** The shape of statusline.py the patcher anchors on, trimmed to the two anchors. */
const ORIGINAL = [
  '#!/usr/bin/env python3',
  'import json',
  'import os',
  'import sys',
  '',
  '',
  'def cache_flush():',
  '    pass',
  '',
  '',
  'def main():',
  '    data = json.load(sys.stdin)',
  '    sys.stdout.write("ctx 21%")',
  '    cache_flush()',
  '',
  '',
  'if __name__ == "__main__":',
  '    main()',
  '',
].join('\n');

const patcher = StatuslinePatcher.fromRepo();

function patch(source: string): string {
  const outcome = patcher.apply(source);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.source;
}

describe('StatuslinePatcher', () => {
  it('round-trips: remove undoes apply byte for byte', () => {
    const outcome = patcher.remove(patch(ORIGINAL));
    expect(outcome.ok && outcome.source).toBe(ORIGINAL);
  });

  it('round-trips on CRLF, and does not leave a mixed-ending file', () => {
    const crlf = ORIGINAL.split('\n').join('\r\n');
    const patched = patch(crlf);
    expect(patched.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
    const outcome = patcher.remove(patched);
    expect(outcome.ok && outcome.source).toBe(crlf);
  });

  it('defines fd_post above main and calls it after cache_flush', () => {
    const lines = patch(ORIGINAL).split('\n');
    const definition = lines.findIndex((line) => line.startsWith('def fd_post('));
    const flush = lines.indexOf('    cache_flush()');
    const call = lines.indexOf('    fd_post(data)');
    expect(definition).toBeGreaterThan(-1);
    expect(definition).toBeLessThan(lines.indexOf('def main():'));
    expect(call).toBeGreaterThan(flush);
  });

  it('flushes stdout before posting, so the render is never behind the network', () => {
    const lines = patch(ORIGINAL).split('\n');
    expect(lines.indexOf('    sys.stdout.flush()')).toBeLessThan(
      lines.indexOf('    fd_post(data)'),
    );
  });

  it('adds no import: the block uses only what statusline.py already imports at the top', () => {
    const added = patch(ORIGINAL)
      .split('\n')
      .filter((line) => /^import |^from /.test(line));
    expect(added).toEqual(['import json', 'import os', 'import sys']);
  });

  it('refuses to patch twice', () => {
    const outcome = patcher.apply(patch(ORIGINAL));
    expect(outcome).toEqual({ ok: false, reason: 'already patched' });
  });

  it('refuses to remove from an unpatched file', () => {
    expect(patcher.remove(ORIGINAL)).toEqual({ ok: false, reason: 'not patched' });
  });

  it('refuses when an anchor has moved rather than guessing where the block goes', () => {
    const moved = ORIGINAL.replace('    cache_flush()', '    cache_flush()  # tidied');
    const outcome = patcher.apply(moved);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toContain('matched 0 lines');
  });

  it('refuses when an anchor is ambiguous', () => {
    const twice = ORIGINAL.replace('    cache_flush()\n', '    cache_flush()\n    cache_flush()\n');
    const outcome = patcher.apply(twice);
    expect(!outcome.ok && outcome.reason).toContain('matched 2 lines');
  });

  it('keeps the token path and both timeouts out of reach of a payload', () => {
    const patched = patch(ORIGINAL);
    expect(patched).toContain('FD_CONNECT_TIMEOUT_S = 0.025');
    expect(patched).toContain('FD_TIMEOUT_S = 0.15');
    expect(patched).toContain('FD_HOST = "127.0.0.1"');
  });
});
