// The config-change digest does not see a plugin's assets — P9-T5.
//
// They come from a config dir's install, not from the repository. Were they in the digest, the
// first read after this build would report every user-scope plugin skill as added to every
// project, and every plugin update afterwards as a change to all of them.
import { describe, expect, it } from 'vitest';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import { configDigest, sameDigest } from '../../contracts/config-snapshot.ts';
import { parseWorkflowMap, type WorkflowMap } from '../../contracts/workflow-map.ts';

function mapOf(assets: readonly ClaudeAsset[]): WorkflowMap | undefined {
  return parseWorkflowMap({ path: 'C:\\Users\\dev\\app-next', at: 1, assets, configured: true });
}

describe('configDigest and plugin assets', () => {
  it('reads the same with or without them', () => {
    const own: ClaudeAsset = {
      kind: 'skill',
      name: 'fix-review',
      description: undefined,
      model: undefined,
      tools: [],
    };
    const before = mapOf([own]);
    const after = mapOf([own, { ...own, name: 'brainstorming', plugin: 'superpowers' }]);
    if (before === undefined || after === undefined) throw new Error('fixture map did not parse');

    expect(configDigest(after).skills).toEqual(['fix-review']);
    expect(sameDigest(configDigest(before), configDigest(after))).toBe(true);
  });
});
