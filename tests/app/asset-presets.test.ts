// A workflow-map row turned into a preset draft — P9-T2.
//
// The three rules the task names, each asserted where a component could not be asked about it: a
// skill or command becomes `/<name> ` and an agent becomes the draft's `agent` with the prompt left
// empty; the function is the one the folder's observed tally says it usually runs under, else
// `claude-365`; and a row whose draft core would refuse offers no button at all.
import { describe, expect, it } from 'vitest';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import type { ObservedBehaviour, ObservedShare } from '../../contracts/observed-behaviour.ts';
import { AssetPresets } from '../../app/deck/asset-presets.ts';

const XPERT = 'C:\\Users\\belas\\Documents\\development\\xpert-new';
const ROSTER = ['german-ui-expert', 'niklas-reviewer', 'orchestrator'];

function asset(kind: ClaudeAsset['kind'], name: string): ClaudeAsset {
  return { kind, name, description: undefined, model: undefined, tools: [] };
}

function observed(shares: readonly ObservedShare[]): ObservedBehaviour {
  return {
    path: XPERT,
    at: 1,
    tookMs: 1,
    sessions: 1,
    sessionsThisWeek: 0,
    bytesRead: 1,
    shares,
    tools: [],
    skills: [],
    sessionNames: [],
    files: [],
    medianPeakContextTokens: 0,
    compactions: 0,
    scheduledFires: 0,
    unknownLines: 0,
  };
}

function presets(tally?: ObservedBehaviour): AssetPresets {
  return new AssetPresets({ root: XPERT, roster: ROSTER, observed: tally });
}

describe('AssetPresets — what a skill or command drafts', () => {
  it('is a slash line with room for the arguments, in the project root, named after it', () => {
    const line = presets().draftFor(asset('skill', 'fix-review'));
    expect(line).toMatchObject({
      name: 'fix-review',
      sessionName: 'fix-review',
      prompt: '/fix-review ',
      promptSource: 'literal',
      cwd: XPERT,
      isRoot: true,
      agent: undefined,
      builtIn: false,
      origin: 'skill fix-review',
    });
  });

  it('treats a command the same way', () => {
    expect(presets().draftFor(asset('command', 'design-check'))?.prompt).toBe('/design-check ');
  });

  it('offers nothing for a name Claude Code would not read as a command', () => {
    for (const name of ['two words', '/leading', '-dash', 'x'.repeat(65), '']) {
      expect(presets().pressable(asset('skill', name))).toBe(false);
    }
  });
});

describe('AssetPresets — what an agent drafts', () => {
  it('sets the agent and leaves the prompt for the owner to write', () => {
    const line = presets().draftFor(asset('agent', 'niklas-reviewer'));
    expect(line).toMatchObject({
      agent: 'niklas-reviewer',
      prompt: '',
      agentChoices: ROSTER,
      agentMissing: false,
      ticketChoices: [],
      pinsAgent: false,
      origin: 'agent niklas-reviewer',
    });
  });

  it('offers nothing for an agent that is not on the roster core checks against', () => {
    expect(presets().pressable(asset('agent', 'Not Shaped'))).toBe(false);
    expect(presets().pressable(asset('agent', 'ghost'))).toBe(false);
  });
});

describe('AssetPresets — which function a draft starts on', () => {
  it('is claude-365 when nobody has read the transcripts', () => {
    const line = presets().draftFor(asset('skill', 'run'));
    expect(line?.profileFn).toBe('claude-365');
    expect(line?.subscription).toBe('365');
  });

  it('follows the subscription the folder has run on most', () => {
    const tally = observed([
      { subscription: '365', sessions: 11, costUsd: 1 },
      { subscription: 'isg', sessions: 31, costUsd: 1 },
    ]);
    const line = presets(tally).draftFor(asset('skill', 'run'));
    expect(line?.profileFn).toBe('claude-isg');
    expect(line?.subscription).toBe('isg');
  });

  it('keeps the default on a tie, and when 365 leads', () => {
    const tie = observed([
      { subscription: '365', sessions: 4, costUsd: 1 },
      { subscription: 'isg', sessions: 4, costUsd: 1 },
    ]);
    expect(presets(tie).profileFn).toBe('claude-365');
    expect(presets(observed([{ subscription: '365', sessions: 9, costUsd: 1 }])).profileFn).toBe(
      'claude-365',
    );
  });
});

describe('AssetPresets — the draft key', () => {
  it('changes with every press, so a second press opens a fresh editor', () => {
    const skill = asset('skill', 'run');
    expect(presets().draftFor(skill, 0)?.key).not.toBe(presets().draftFor(skill, 1)?.key);
  });
});

describe('AssetPresets — a plugin asset (P9-T5)', () => {
  const plugin = (kind: ClaudeAsset['kind'], name: string, from: string): ClaudeAsset => ({
    ...asset(kind, name),
    plugin: from,
  });

  it('drafts a plugin skill as its namespaced slash line, named with the bare name', () => {
    const line = presets().draftFor(plugin('skill', 'brainstorming', 'superpowers'));
    expect(line).toMatchObject({
      name: 'superpowers:brainstorming',
      sessionName: 'brainstorming',
      prompt: '/superpowers:brainstorming ',
      origin: 'skill superpowers:brainstorming',
    });
  });

  it('drafts a plugin agent under its scoped name when the roster holds that name', () => {
    const scoped = 'shell-review:bash-script-auditor';
    const withPlugin = new AssetPresets({ root: XPERT, roster: [scoped], observed: undefined });
    expect(withPlugin.draftFor(plugin('agent', 'bash-script-auditor', 'shell-review'))?.agent).toBe(
      scoped,
    );
    // The bare name on the roster is not the same agent — core checks the scoped one.
    const bare = new AssetPresets({
      root: XPERT,
      roster: ['bash-script-auditor'],
      observed: undefined,
    });
    expect(bare.pressable(plugin('agent', 'bash-script-auditor', 'shell-review'))).toBe(false);
  });

  it('keys a plugin skill apart from a project skill of the same name', () => {
    const own = presets().draftFor(asset('skill', 'review'));
    const theirs = presets().draftFor(plugin('skill', 'review', 'superpowers'));
    expect(own?.key).not.toBe(theirs?.key);
  });
});
