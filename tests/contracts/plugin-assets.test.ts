// A plugin's asset on the wire, its scoped name, and that name as an agent — P9-T5.
//
// The scoped form is Claude Code's: `/my-plugin:review` for a skill and `my-plugin:reviewer` for an
// agent, which `--agent` takes as written (code.claude.com/docs/en/plugins/components,
// code.claude.com/docs/en/sub-agents).
import { describe, expect, it } from 'vitest';
import {
  parseAsset,
  parseClaudeAsset,
  scopedAssetName,
  type ClaudeAsset,
} from '../../contracts/claude-assets.ts';
import { agentName, agentRoster } from '../../contracts/launch-preset.ts';

function asset(kind: ClaudeAsset['kind'], name: string, plugin?: string): ClaudeAsset {
  const own: ClaudeAsset = { kind, name, description: undefined, model: undefined, tools: [] };
  return plugin === undefined ? own : { ...own, plugin };
}

describe('scopedAssetName', () => {
  it("is the bare name for the project's own and plugin:name for a plugin's", () => {
    expect(scopedAssetName(asset('skill', 'fix-review'))).toBe('fix-review');
    expect(scopedAssetName(asset('skill', 'brainstorming', 'superpowers'))).toBe(
      'superpowers:brainstorming',
    );
  });
});

describe('parseClaudeAsset — the plugin field', () => {
  it('carries a plugin-shaped plugin', () => {
    expect(
      parseClaudeAsset({ kind: 'skill', name: 'brainstorming', plugin: 'superpowers' }),
    ).toEqual(asset('skill', 'brainstorming', 'superpowers'));
  });

  it('keeps an asset with no plugin exactly as it was', () => {
    expect(parseClaudeAsset({ kind: 'agent', name: 'reviewer' })).not.toHaveProperty('plugin');
  });

  it.each(['', 'Super Powers', 'a:b', 7, null])('drops the asset whose plugin is %j', (plugin) => {
    expect(parseClaudeAsset({ kind: 'skill', name: 's', plugin })).toBeUndefined();
  });
});

describe('a plugin agent as an --agent value', () => {
  it.each(['shell-review:bash-script-auditor', 'p:a', `${'p'.repeat(64)}:${'a'.repeat(64)}`])(
    'takes %j',
    (name) => {
      expect(agentName(name)).toBe(name);
    },
  );

  it.each(['a:b:c', ':a', 'a:', 'P:a', '-p:a', 'p;x:a', `${'p'.repeat(65)}:a`])(
    'refuses %j',
    (name) => {
      expect(agentName(name)).toBeUndefined();
    },
  );

  it('puts a plugin agent on the roster by its scoped name, and never a plugin skill', () => {
    expect(
      agentRoster([
        asset('agent', 'reviewer'),
        asset('agent', 'bash-script-auditor', 'shell-review'),
        asset('skill', 'brainstorming', 'superpowers'),
      ]),
    ).toEqual(['reviewer', 'shell-review:bash-script-auditor']);
  });
});

describe('parseAsset — a folded description', () => {
  it("reads `description: >` as the indented paragraph under it, as shell-review's agent has it", () => {
    const head = [
      '---',
      'name: bash-script-auditor',
      'description: >',
      '  Bash script linter and pitfall detector.',
      '  Use proactively when reviewing bash scripts.',
      'model: sonnet',
      '---',
    ].join('\n');

    const parsed = parseAsset('agent', 'bash-script-auditor', head);

    expect(parsed?.description).toBe(
      'Bash script linter and pitfall detector. Use proactively when reviewing bash scripts.',
    );
    expect(parsed?.model).toBe('sonnet');
  });

  it('reads a block indicator with nothing under it as no description', () => {
    const head = ['---', 'name: x', 'description: |', 'model: haiku', '---'].join('\n');
    expect(parseAsset('agent', 'x', head)?.description).toBeUndefined();
  });
});
