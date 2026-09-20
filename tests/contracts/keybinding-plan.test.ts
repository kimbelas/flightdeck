// P5a-T7. The parser is the gate on a file this project did not write and must not corrupt, so
// every shape that is NOT a keybindings.json has to come back `undefined` rather than be coerced.
import { describe, expect, it } from 'vitest';
import {
  RECLAIMED_KEYS,
  parseKeybindingPlan,
  parseKeybindingWrite,
  parseKeybindingsFile,
} from '../../contracts/keybinding-plan.ts';

describe('parseKeybindingsFile', () => {
  it('reads a file and keeps everything that is not bindings', () => {
    const file = parseKeybindingsFile(
      JSON.stringify({
        $schema: 'https://example.invalid/s.json',
        somethingNew: { deep: true },
        bindings: [{ context: 'Global', bindings: { 'ctrl+t': null, 'ctrl+x ctrl+t': 'app:x' } }],
      }),
    );

    expect(file?.bindings).toEqual([
      { context: 'Global', bindings: { 'ctrl+t': null, 'ctrl+x ctrl+t': 'app:x' } },
    ]);
    // The whole point of `rest`: a rewrite must not drop a key this project has never heard of.
    expect(file?.rest).toEqual({
      $schema: 'https://example.invalid/s.json',
      somethingNew: { deep: true },
    });
  });

  it('treats a file with no bindings key as an empty one rather than a refusal', () => {
    expect(parseKeybindingsFile('{"$schema":"x"}')).toEqual({
      bindings: [],
      rest: { $schema: 'x' },
    });
  });

  it('refuses everything it must not rewrite', () => {
    for (const text of [
      'not json',
      '',
      '[]',
      'null',
      '"a string"',
      '{"bindings":{}}',
      '{"bindings":"Global"}',
      '{"bindings":[{"context":"Global"}]}',
      '{"bindings":[{"bindings":{}}]}',
      '{"bindings":[{"context":"","bindings":{}}]}',
      '{"bindings":[{"context":"Global","bindings":[]}]}',
      '{"bindings":[{"context":"Global","bindings":{"ctrl+t":7}}]}',
      '{"bindings":[{"context":"Global","bindings":{"ctrl+t":{"a":1}}}]}',
    ]) {
      expect(parseKeybindingsFile(text), text).toBeUndefined();
    }
  });

  it('keeps a null, because a null is how a default is unbound', () => {
    const file = parseKeybindingsFile(
      '{"bindings":[{"context":"Chat","bindings":{"ctrl+s":null}}]}',
    );
    expect(file?.bindings[0]?.bindings['ctrl+s']).toBeNull();
  });
});

describe('RECLAIMED_KEYS', () => {
  it('moves each key to a chord, never to another single key the browser might take', () => {
    for (const remap of RECLAIMED_KEYS) {
      expect(remap.to).toContain(' ');
      expect(remap.to.startsWith('ctrl+x ')).toBe(true);
      expect(remap.from).not.toBe(remap.to);
    }
  });

  it('never uses a ctrl+k chord, which the deck claims away from a pane (D34)', () => {
    expect(RECLAIMED_KEYS.some((remap) => remap.to.startsWith('ctrl+k'))).toBe(false);
  });

  it('does not claim to move ctrl+w, which no file can', () => {
    expect(RECLAIMED_KEYS.some((remap) => remap.from === 'ctrl+w')).toBe(false);
  });
});

describe('the wire parsers', () => {
  it('reads an accepted plan', () => {
    const plan = parseKeybindingPlan({
      plan: {
        ok: true,
        changes: [{ path: 'p', label: 'l', before: 'a', after: 'b' }],
        alreadyDone: ['q'],
      },
    });
    expect(plan).toEqual({
      ok: true,
      changes: [{ path: 'p', label: 'l', before: 'a', after: 'b' }],
      alreadyDone: ['q'],
    });
  });

  it('reads a refused plan', () => {
    expect(
      parseKeybindingPlan({ plan: { ok: false, refusals: [{ path: 'p', reason: 'r' }] } }),
    ).toEqual({ ok: false, refusals: [{ path: 'p', reason: 'r' }] });
  });

  it('refuses a body it does not recognise rather than half-reading it', () => {
    for (const body of [
      undefined,
      null,
      {},
      { plan: null },
      { plan: { ok: 'yes' } },
      { plan: { ok: true, changes: 'none', alreadyDone: [] } },
      { plan: { ok: true, changes: [{ path: 'p' }], alreadyDone: [] } },
      { plan: { ok: false, refusals: [{ path: 'p' }] } },
    ]) {
      expect(parseKeybindingPlan(body), JSON.stringify(body)).toBeUndefined();
    }
  });

  it('reads a write, and refuses one missing a list', () => {
    expect(parseKeybindingWrite({ written: ['a'], backups: ['b'], alreadyDone: [] })).toEqual({
      written: ['a'],
      backups: ['b'],
      alreadyDone: [],
    });
    expect(parseKeybindingWrite({ written: ['a'], backups: ['b'] })).toBeUndefined();
  });
});
