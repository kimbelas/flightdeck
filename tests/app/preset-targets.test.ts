// Single presets and a typed ticket as palette entries — P9-T4, app/deck/preset-targets.ts.
//
// The cases worth the file: the order (the current project first), what a press would send — which
// must be exactly what the preset's own start sends — the entries that open an editor rather than
// press a launch core would refuse, and `Plan` offering nothing without a current project.
import { describe, expect, it } from 'vitest';
import type { LaunchPreset } from '../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import {
  NO_GAUGE,
  type QuotaSummary,
  type SubscriptionQuota,
} from '../../contracts/quota-summary.ts';
import { TicketPrompt } from '../../contracts/ticket-prompt.ts';
import { parseWorkflowMap, type WorkflowMap } from '../../contracts/workflow-map.ts';
import { presetTargets, ticketTarget, type PresetSources } from '../../app/deck/preset-targets.ts';

const NOW = 1_789_000_100_000;
const KIT: ProjectRecord = { path: 'C:\\dev\\claude-kit', name: 'claude-kit', importedAt: 1 };
const XPERT: ProjectRecord = { path: 'C:\\dev\\xpert-new', name: 'xpert-new', importedAt: 2 };

/** The four built-ins `PresetCatalogue` computes for a project, prompts empty as core sends them. */
function builtIns(project: ProjectRecord): readonly LaunchPreset[] {
  const base = { projectKey: projectKey(project.path), cwd: project.path, prompt: '' };
  const rest = { group: undefined, agent: undefined, builtIn: true };
  return [
    { ...base, ...rest, id: '365', name: '365', profileFn: 'claude-365', sessionName: project.name, promptSource: 'literal' }, // prettier-ignore
    { ...base, ...rest, id: 'isg', name: 'isg', profileFn: 'claude-isg', sessionName: project.name, promptSource: 'literal' }, // prettier-ignore
    { ...base, ...rest, id: 'ticket', name: 'ticket', profileFn: 'claude-isg-ticket', sessionName: '', promptSource: 'ticket' }, // prettier-ignore
    { ...base, ...rest, id: 'orchestrator', name: 'orchestrator', profileFn: 'claude-isg-orch', sessionName: 'orchestrator', promptSource: 'literal' }, // prettier-ignore
  ];
}

function mapOf(project: ProjectRecord, over: Readonly<Record<string, unknown>>): WorkflowMap {
  const map = parseWorkflowMap({ path: project.path, at: NOW, ...over });
  if (map === undefined) throw new Error('the fixture map did not parse');
  return map;
}

function sources(over: Partial<PresetSources> = {}): PresetSources {
  return {
    presets: [...builtIns(XPERT), ...builtIns(KIT)],
    projects: [KIT, XPERT],
    maps: {},
    current: undefined,
    quota: undefined,
    now: NOW,
    ...over,
  };
}

function saved(over: Partial<LaunchPreset>): LaunchPreset {
  return {
    projectKey: projectKey(XPERT.path),
    id: 'review',
    name: 'review',
    profileFn: 'claude-365',
    cwd: XPERT.path,
    sessionName: 'review',
    promptSource: 'literal',
    prompt: '/fix-review ',
    group: undefined,
    agent: undefined,
    builtIn: false,
    ...over,
  };
}

describe('presetTargets', () => {
  it('offers every preset of every project, by project then name', () => {
    expect(presetTargets(sources()).map((target) => target.label)).toEqual([
      'Launch claude-kit · 365',
      'Launch claude-kit · isg',
      'Launch claude-kit · orchestrator',
      'Launch claude-kit · ticket',
      'Launch xpert-new · 365',
      'Launch xpert-new · isg',
      'Launch xpert-new · orchestrator',
      'Launch xpert-new · ticket',
    ]);
  });

  it("puts the current project's presets first, and keeps the rest in order", () => {
    const labels = presetTargets(sources({ current: projectKey(XPERT.path) })).map((t) => t.label);
    expect(labels.slice(0, 4).every((label) => label.startsWith('Launch xpert-new'))).toBe(true);
    expect(labels[4]).toBe('Launch claude-kit · 365');
  });

  it('opens the editor for a built-in, because an empty prompt cannot start a --bg session', () => {
    const targets = presetTargets(sources());
    expect(targets.every((target) => target.launch === undefined)).toBe(true);
    const ticket = targets.find((target) => target.label === 'Launch claude-kit · ticket');
    expect(ticket?.box).toBe('name');
    expect(ticket?.hint).toContain('opens it for a ticket id');
    expect(targets[0]?.box).toBe('prompt');
    expect(targets[0]?.chip).toBe(`${projectKey(KIT.path)}|365`);
  });

  it('launches a startable preset with exactly what its own start would send', () => {
    const preset = saved({});
    const [target] = presetTargets(sources({ presets: [preset] }));
    expect(target?.launch).toEqual({
      profileFn: 'claude-365',
      prompt: '/fix-review ',
      name: 'review',
      cwd: XPERT.path,
      agent: undefined,
    });
  });

  it('opens the editor for a saved agent the roster has lost, rather than pressing a refusal', () => {
    const preset = saved({ agent: 'niklas-reviewer' });
    const agent = {
      kind: 'agent',
      name: 'niklas-reviewer',
      description: '',
      path: 'agents/niklas-reviewer.md',
    };
    const kept = sources({ presets: [preset], maps: { [preset.projectKey]: mapOf(XPERT, { assets: [agent] }) } }); // prettier-ignore
    expect(presetTargets(kept)[0]?.launch?.agent).toBe('niklas-reviewer');
    const lost = presetTargets(sources({ presets: [preset] }))[0];
    expect(lost?.launch).toBeUndefined();
    expect(lost?.hint).toContain('niklas-reviewer is no longer on the roster');
  });

  it('drops a preset whose project is not in the registry — there is no name to label it', () => {
    expect(presetTargets(sources({ projects: [KIT] })).length).toBe(4);
  });

  it('says which account a press lands on, with the routing advice when there is a reading', () => {
    expect(presetTargets(sources())[0]?.hint.startsWith('365 · claude-365')).toBe(true);
    const quota = quotaOf(90, 20);
    const hint = presetTargets(sources({ quota }))[0]?.hint ?? '';
    expect(hint).toContain('365 · claude-365 · claude-isg has more headroom');
    expect(hint).toContain('isg 80% free (7d)');
  });
});

describe('ticketTarget', () => {
  const current = projectKey(XPERT.path);
  const listed = sources({
    current,
    maps: { [current]: mapOf(XPERT, { tickets: ['XWEB-2126'] }) },
  });

  it("plans a typed id in the current project, through that project's ticket preset", () => {
    const target = ticketTarget('xweb-2126', listed);
    expect(target?.label).toBe('Plan XWEB-2126 in xpert-new');
    expect(target?.launch).toEqual({
      profileFn: 'claude-isg-ticket',
      prompt: new TicketPrompt('XWEB-2126').text,
      name: 'XWEB-2126',
      cwd: XPERT.path,
      agent: undefined,
    });
    expect(target?.hint).toBe('isg · claude-isg-ticket · on disk');
  });

  it('still offers an id that is not on disk, and says so', () => {
    const target = ticketTarget('XWEB-9999', listed);
    expect(target?.label).toBe('Plan XWEB-9999 in xpert-new');
    expect(target?.hint).toContain('not on disk yet');
  });

  it('finds the id among other words, so `plan xweb-1` works too', () => {
    expect(ticketTarget('plan xweb-1', listed)?.label).toBe('Plan XWEB-1 in xpert-new');
  });

  it('offers nothing when there is no current project — a guess is the wrong folder', () => {
    expect(ticketTarget('XWEB-2126', sources())).toBeUndefined();
  });

  it('offers nothing for a query that is not ticket-shaped', () => {
    expect(ticketTarget('xpert', listed)).toBeUndefined();
    expect(ticketTarget('', listed)).toBeUndefined();
  });

  it('offers nothing when the ticket preset was saved over with a literal prompt', () => {
    const shadowed = saved({ id: 'ticket', name: 'ticket', promptSource: 'literal' });
    const others = builtIns(XPERT).filter((preset) => preset.id !== 'ticket');
    expect(ticketTarget('XWEB-1', { ...listed, presets: [...others, shadowed] })).toBeUndefined();
  });
});

function quotaOf(used365: number, usedIsg: number): QuotaSummary {
  return { at: NOW, subscriptions: [entry('isg', usedIsg), entry('365', used365)] };
}

function entry(id: 'isg' | '365', used: number): SubscriptionQuota {
  const gauge = { usedPercentage: used, resetsAt: NOW + 7_200_000, at: NOW - 1000 };
  return {
    subscription: id,
    at: NOW - 1000,
    fiveHour: NO_GAUGE,
    sevenDay: gauge,
    claudeVersion: '2.1.7',
    spendUsd: 1,
    spendingSessions: 1,
  };
}
