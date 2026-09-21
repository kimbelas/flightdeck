// What the palette offers to press — P6-T4, D17.
//
// A test of the hint as much as of the list, because this is the only entry in the palette that
// spends quota and the hint is the last place somebody can change their mind about spending it.
import { describe, expect, it } from 'vitest';
import type { LaunchPreset } from '../../contracts/launch-preset.ts';
import { MAX_GROUP_LAUNCH } from '../../contracts/preset-group.ts';
import { groupTargets } from '../../app/deck/group-targets.ts';

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
    builtIn: false,
    ...over,
  };
}

describe('groupTargets', () => {
  it('offers nothing when no preset has a group', () => {
    expect(groupTargets([presetOf({ group: undefined })])).toEqual([]);
  });

  it('offers one entry per group, with the count the press will cost', () => {
    const targets = groupTargets([
      presetOf({ id: 'a', name: 'alpha' }),
      presetOf({ id: 'b', name: 'beta' }),
    ]);

    expect(targets).toEqual([{ key: 'morning', name: 'morning', presets: 2, tooLarge: false }]);
  });

  it('shows the group the way it was spelled, not the way it is matched', () => {
    expect(groupTargets([presetOf({ group: 'Morning' })])[0]).toEqual({
      key: 'morning',
      name: 'Morning',
      presets: 1,
      tooLarge: false,
    });
  });

  /**
   * A group over the cap says so in the palette rather than being refused after the press.
   *
   * Core refuses it either way (`GroupLauncher`), so this is not the control — it is the last
   * place somebody can see that a press would be refused while they can still not make it.
   */
  it('marks a group over the cap, rather than letting the press find out', () => {
    const tooMany = Array.from({ length: MAX_GROUP_LAUNCH + 1 }, (unused, index) =>
      presetOf({ id: `p${String(index)}`, name: `p${String(index)}` }),
    );

    expect(groupTargets(tooMany)[0]?.tooLarge).toBe(true);
  });

  it('does not mark a group exactly at the cap', () => {
    const atCap = Array.from({ length: MAX_GROUP_LAUNCH }, (unused, index) =>
      presetOf({ id: `p${String(index)}`, name: `p${String(index)}` }),
    );

    expect(groupTargets(atCap)[0]?.tooLarge).toBe(false);
  });

  it('counts presets from different projects under one name', () => {
    const targets = groupTargets([
      presetOf({ projectKey: 'c:\\one', id: 'a', name: 'alpha' }),
      presetOf({ projectKey: 'c:\\two', id: 'b', name: 'beta' }),
    ]);

    expect(targets[0]?.presets).toBe(2);
  });

  // A list that reorders between reads is one React rebuilds rather than reconciles.
  it('orders the entries, so the palette does not reshuffle', () => {
    const targets = groupTargets([
      presetOf({ id: 'a', name: 'a', group: 'zulu' }),
      presetOf({ id: 'b', name: 'b', group: 'alpha' }),
    ]);

    expect(targets.map((target) => target.key)).toEqual(['alpha', 'zulu']);
  });
});
