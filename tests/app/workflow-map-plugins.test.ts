// The map panel's plugin headings — P9-T5.
//
// A plugin's assets are the config dir's, not the repository's: they get a heading per plugin and
// one count on the closed line, and they stay out of the project's own three lists.
import { describe, expect, it } from 'vitest';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import { parseWorkflowMap } from '../../contracts/workflow-map.ts';
import { WorkflowMapViewModel } from '../../app/deck/workflow-map-view-model.ts';

function asset(kind: ClaudeAsset['kind'], name: string, plugin?: string): ClaudeAsset {
  const own: ClaudeAsset = { kind, name, description: undefined, model: undefined, tools: [] };
  return plugin === undefined ? own : { ...own, plugin };
}

function model(assets: readonly ClaudeAsset[]): WorkflowMapViewModel {
  return new WorkflowMapViewModel(
    parseWorkflowMap({ path: 'C:\\Users\\dev\\app-next', at: 1, assets, configured: true }),
  );
}

const MIXED = model([
  asset('agent', 'german-ui-expert'),
  asset('skill', 'fix-review'),
  asset('agent', 'bash-script-auditor', 'shell-review'),
  asset('skill', 'brainstorming', 'superpowers'),
  asset('skill', 'writing-plans', 'superpowers'),
]);

describe('plugin assets on the map', () => {
  it("keeps the project's own lists and counts to the project's own", () => {
    expect(MIXED.agents.map((entry) => entry.name)).toEqual(['german-ui-expert']);
    expect(MIXED.skills.map((entry) => entry.name)).toEqual(['fix-review']);
    expect(MIXED.summary).toEqual(['1 agent', '1 skill', '3 plugin assets']);
  });

  it('groups them under their plugin, in the order core sent them', () => {
    expect(
      MIXED.pluginGroups.map((group) => [group.plugin, group.assets.map((entry) => entry.name)]),
    ).toEqual([
      ['shell-review', ['bash-script-auditor']],
      ['superpowers', ['brainstorming', 'writing-plans']],
    ]);
  });

  it('says 1 plugin asset, and draws no heading for a map with none', () => {
    expect(model([asset('skill', 'x', 'p')]).summary).toEqual(['1 plugin asset']);
    expect(model([asset('skill', 'fix-review')]).pluginGroups).toEqual([]);
  });
});
