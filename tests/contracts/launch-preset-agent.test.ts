// The agent field on a preset — P9-T1, D59.
//
// A name reaches an argv element, a JSON body, a database column and a log line, so the contract
// is shape first: anything that is not `AGENT_SHAPE` is refused where it is parsed, never escaped.
import { describe, expect, it } from 'vitest';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import {
  agentName,
  agentRoster,
  optionalAgent,
  parseLaunchPreset,
  parsePresetDraft,
  pinsAgent,
  PRESET_REFUSALS,
  PROFILE_FUNCTIONS,
  type LaunchPreset,
} from '../../contracts/launch-preset.ts';

const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;

describe('the agent field (P9-T1)', () => {
  it('pins an agent on exactly one function', () => {
    expect(PROFILE_FUNCTIONS.filter((profileFn) => pinsAgent(profileFn))).toEqual([
      'claude-isg-orch',
    ]);
  });

  it.each(['code-reviewer', 'a', 'x'.repeat(64), 'agent-2'])('takes %j as a name', (name) => {
    expect(agentName(name)).toBe(name);
  });

  it.each(['', 'Code', 'a b', 'a;b', 'x'.repeat(65), '../x', 7, null])(
    'refuses %j as a name',
    (value) => {
      expect(agentName(value)).toBeUndefined();
    },
  );

  it('reads absent, null and empty as none, and anything else unshaped as a refusal', () => {
    expect(optionalAgent(undefined)).toBeUndefined();
    expect(optionalAgent(null)).toBeUndefined();
    expect(optionalAgent('')).toBeUndefined();
    expect(optionalAgent('reviewer')).toBe('reviewer');
    expect(optionalAgent('Reviewer')).toBe(false);
  });

  it('builds a roster from agents only, agent-shaped, unique and sorted', () => {
    const asset = (kind: 'agent' | 'command' | 'skill', name: string): ClaudeAsset => ({
      kind,
      name,
      description: undefined,
      model: undefined,
      tools: [],
    });

    expect(
      agentRoster([
        asset('agent', 'zeta'),
        asset('agent', 'alpha'),
        asset('agent', 'alpha'),
        asset('agent', 'Bad Name'),
        asset('skill', 'brainstorming'),
      ]),
    ).toEqual(['alpha', 'zeta']);
  });

  it('carries an agent on a draft, and refuses a draft whose agent is not a name', () => {
    const draftBody = (agent: unknown): string =>
      JSON.stringify({
        projectPath: APP_NEXT,
        name: 'review',
        profileFn: 'claude-365',
        promptSource: 'literal',
        prompt: 'go',
        agent,
      });

    expect(parsePresetDraft(draftBody('code-reviewer'))?.agent).toBe('code-reviewer');
    expect(parsePresetDraft(draftBody(null))?.agent).toBeUndefined();
    // Refused, never saved with the agent quietly dropped.
    expect(parsePresetDraft(draftBody('Code Reviewer'))).toBeUndefined();
  });

  it('reads an agent off the wire, and drops one that is not a name', () => {
    const wire = { projectKey: 'k', id: 'review', cwd: APP_NEXT, profileFn: 'claude-365' };
    const read = (agent: unknown): LaunchPreset | undefined =>
      parseLaunchPreset({ ...wire, promptSource: 'literal', agent });

    expect(read('code-reviewer')?.agent).toBe('code-reviewer');
    expect(read('rm -rf')?.agent).toBeUndefined();
  });

  it('has a refusal for each of the two agent causes', () => {
    expect(PRESET_REFUSALS).toContain('pins_agent');
    expect(PRESET_REFUSALS).toContain('unknown_agent');
  });
});
