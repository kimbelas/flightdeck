// What a preset group IS — P6-T4, D17.
//
// A group is derived from `LaunchPreset.group` rather than stored, so every question about one is
// a question about this file: which presets are in it, what it is called, and what order they come
// back in. Both ends read the same answer — core resolves what a press launches, the deck draws
// what there is to press — so a disagreement here is a button that 404s.
import { describe, expect, it } from 'vitest';
import type { LaunchPreset } from '../../contracts/launch-preset.ts';
import {
  findGroup,
  groupKey,
  parseGroupLaunchReport,
  presetGroups,
  startedCount,
} from '../../contracts/preset-group.ts';

function presetOf(over: Partial<LaunchPreset> = {}): LaunchPreset {
  return {
    projectKey: 'c:\\repo',
    id: 'ticket',
    name: 'ticket',
    profileFn: 'claude-isg-ticket',
    cwd: 'C:\\repo',
    sessionName: 'fd-ticket',
    promptSource: 'literal',
    prompt: 'go',
    group: 'morning',
    agent: undefined,
    builtIn: false,
    ...over,
  };
}

describe('groupKey', () => {
  it.each([
    { name: 'morning', key: 'morning', why: 'a plain name' },
    { name: 'Morning', key: 'morning', why: 'a capital' },
    { name: '  morning  ', key: 'morning', why: 'surrounding space' },
  ])('folds $why', ({ name, key }) => {
    expect(groupKey(name)).toBe(key);
  });

  it.each([
    { name: '', why: 'an empty name' },
    { name: '   ', why: 'a name that is only whitespace' },
  ])('refuses $why', ({ name }) => {
    expect(groupKey(name)).toBeUndefined();
  });
});

describe('presetGroups', () => {
  it('finds nothing in a list where nothing is grouped', () => {
    expect(presetGroups([presetOf({ group: undefined })])).toEqual([]);
  });

  it('gathers presets under one name', () => {
    const groups = presetGroups([
      presetOf({ id: 'a', name: 'alpha' }),
      presetOf({ id: 'b', name: 'beta' }),
    ]);

    expect(groups.length).toBe(1);
    expect(groups[0]?.presets.map((preset) => preset.name)).toEqual(['alpha', 'beta']);
  });

  // Two buttons a capital apart is a bug the owner would file against themselves.
  it('treats two spellings as one group, and shows the first one seen', () => {
    const groups = presetGroups([
      presetOf({ id: 'a', name: 'alpha', group: 'Morning' }),
      presetOf({ id: 'b', name: 'beta', group: 'morning' }),
    ]);

    expect(groups.length).toBe(1);
    expect(groups[0]?.key).toBe('morning');
    expect(groups[0]?.name).toBe('Morning');
    expect(groups[0]?.presets.length).toBe(2);
  });

  // A group spans projects, because "morning" means the owner's morning rather than one
  // repository's — which is the whole reason it reads `PresetBook.list()` rather than one project.
  it('spans projects', () => {
    const groups = presetGroups([
      presetOf({ projectKey: 'c:\\one', id: 'a', name: 'alpha' }),
      presetOf({ projectKey: 'c:\\two', id: 'b', name: 'beta' }),
    ]);

    expect(groups[0]?.presets.length).toBe(2);
  });

  it('keeps separate names apart', () => {
    const groups = presetGroups([
      presetOf({ id: 'a', name: 'alpha', group: 'evening' }),
      presetOf({ id: 'b', name: 'beta', group: 'morning' }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(['evening', 'morning']);
  });

  // A list that reorders between reads is one React rebuilds rather than reconciles.
  it('orders groups by key, so the palette does not reshuffle', () => {
    const groups = presetGroups([
      presetOf({ id: 'a', name: 'a', group: 'zulu' }),
      presetOf({ id: 'b', name: 'b', group: 'alpha' }),
      presetOf({ id: 'c', name: 'c', group: 'mike' }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(['alpha', 'mike', 'zulu']);
  });

  it('orders the presets inside a group the way the presets panel lists them', () => {
    const groups = presetGroups([
      presetOf({ id: 'z', name: 'zulu' }),
      presetOf({ id: 'a', name: 'alpha' }),
    ]);

    expect(groups[0]?.presets.map((preset) => preset.name)).toEqual(['alpha', 'zulu']);
  });

  it('ignores a group name that is only whitespace, rather than making a nameless group', () => {
    expect(presetGroups([presetOf({ group: '   ' })])).toEqual([]);
  });
});

describe('findGroup', () => {
  it('finds one by name, whatever the case', () => {
    expect(findGroup([presetOf({ group: 'Morning' })], 'MORNING')?.key).toBe('morning');
  });

  it.each([
    { name: 'evening', why: 'a group nobody has' },
    { name: '', why: 'an empty name' },
  ])('answers undefined for $why', ({ name }) => {
    expect(findGroup([presetOf()], name)).toBeUndefined();
  });
});

describe('parseGroupLaunchReport', () => {
  it('reads a report', () => {
    const parsed = parseGroupLaunchReport({
      group: 'morning',
      outcomes: [{ presetId: 'a', name: 'alpha', sessionId: 'sess' }],
    });

    expect(parsed).toEqual({
      group: 'morning',
      outcomes: [{ presetId: 'a', name: 'alpha', sessionId: 'sess', failure: undefined }],
    });
  });

  it('reads a failed outcome', () => {
    const parsed = parseGroupLaunchReport({
      group: 'morning',
      outcomes: [{ presetId: 'a', name: 'alpha', failure: 'no_shell' }],
    });

    expect(parsed?.outcomes[0]).toEqual({
      presetId: 'a',
      name: 'alpha',
      sessionId: undefined,
      failure: 'no_shell',
    });
  });

  /**
   * Exactly one of the two, never both and never neither.
   *
   * What this carries becomes a sentence about the owner's quota having been spent, so a row that
   * claims a session started AND that it failed is one this build cannot draw — and drawing it
   * either way would be inventing which.
   */
  it.each([
    {
      outcome: { presetId: 'a', name: 'alpha', sessionId: 'sess', failure: 'no_shell' },
      why: 'an outcome claiming both',
    },
    { outcome: { presetId: 'a', name: 'alpha' }, why: 'an outcome claiming neither' },
    { outcome: { presetId: 'a', name: 'alpha', sessionId: '' }, why: 'an empty session id' },
    { outcome: { presetId: '', name: 'alpha', sessionId: 'sess' }, why: 'no preset id' },
    { outcome: { presetId: 'a', sessionId: 'sess' }, why: 'no name' },
    { outcome: 'alpha', why: 'an outcome that is a string' },
  ])('drops $why rather than showing it as either', ({ outcome }) => {
    const parsed = parseGroupLaunchReport({ group: 'morning', outcomes: [outcome] });

    expect(parsed?.outcomes).toEqual([]);
  });

  it.each([
    { value: {}, why: 'a body with nothing in it' },
    { value: { group: 'morning' }, why: 'a report with no outcomes' },
    { value: { outcomes: [] }, why: 'a report with no group' },
    { value: { group: 7, outcomes: [] }, why: 'a group that is not a string' },
    { value: { group: 'morning', outcomes: {} }, why: 'outcomes that are not a list' },
    { value: null, why: 'null' },
    { value: [], why: 'an array' },
  ])('refuses $why', ({ value }) => {
    expect(parseGroupLaunchReport(value)).toBeUndefined();
  });
});

describe('startedCount', () => {
  it('counts only what actually started', () => {
    expect(
      startedCount({
        group: 'morning',
        outcomes: [
          { presetId: 'a', name: 'a', sessionId: 'one', failure: undefined },
          { presetId: 'b', name: 'b', sessionId: undefined, failure: 'no_shell' },
          { presetId: 'c', name: 'c', sessionId: 'two', failure: undefined },
        ],
      }),
    ).toBe(2);
  });
});
