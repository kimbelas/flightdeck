// The Start launcher, tested without React — P10-T2, CODING-STANDARDS §10.4.
import { describe, expect, it } from 'vitest';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import { parseWorkflowMap, type WorkflowMap } from '../../contracts/workflow-map.ts';
import {
  EMPTY_START_DRAFT,
  StartLauncherViewModel,
  type AccountMemories,
  parseMemories,
  type StartDraft,
} from '../../app/deck/start-launcher-view-model.ts';

const XPERT = String.raw`C:\Users\dev\Documents\development\xpert-new`;
const APOLLO = String.raw`C:\Users\dev\Documents\development\365connect\apollo-v13`;
// 2026-09-27 09:05 local — the name stamp is local time, so the test builds it the same way.
const NOW = new Date(2026, 8, 27, 9, 5).getTime();

const PROJECTS: readonly ProjectRecord[] = [
  { path: XPERT, name: 'xpert-new', importedAt: 1 },
  { path: APOLLO, name: 'apollo-v13', importedAt: 2 },
];

// Off the wire, through the deck's own parser — the one the fixture core uses too.
const ASSETS = [
  { kind: 'skill', name: 'ship', description: 'Land a change.' },
  { kind: 'command', name: 'design-check' },
  { kind: 'skill', name: 'brainstorming', plugin: 'superpowers' },
  { kind: 'agent', name: 'code-reviewer', description: 'Reviews a diff.' },
  { kind: 'agent', name: 'Not An Agent Name' },
];

function mapOf(assets: readonly unknown[]): WorkflowMap {
  const map = parseWorkflowMap({ path: XPERT, at: 1, assets });
  if (map === undefined) throw new Error('the fixture map did not parse');
  return map;
}

function model(
  draft: Partial<StartDraft> = {},
  memory: AccountMemories = {},
): StartLauncherViewModel {
  return new StartLauncherViewModel({
    projects: PROJECTS,
    maps: { [projectKey(XPERT)]: mapOf(ASSETS) },
    quota: undefined,
    memory,
    draft: { ...EMPTY_START_DRAFT, ...draft },
    now: NOW,
  });
}

const XPERT_KEY = projectKey(XPERT);
const APOLLO_KEY = projectKey(APOLLO);

describe('StartLauncherViewModel — the tiles', () => {
  it('offers every imported folder by name, and marks the locked ones', () => {
    const tiles = model({}, { [APOLLO_KEY]: { account: '365', locked: true } }).tiles;

    expect(tiles.map((tile) => tile.name)).toEqual(['apollo-v13', 'xpert-new']);
    expect(tiles.map((tile) => tile.lockedTo)).toEqual(['365', undefined]);
  });

  it('asks for a project before anything else', () => {
    expect(model().missing).toBe('Pick a project');
    expect(model().launch()).toBeUndefined();
  });
});

describe('StartLauncherViewModel — the account', () => {
  it('defaults to isg with nothing remembered and no quota', () => {
    expect(model({ projectKey: XPERT_KEY }).account).toBe('isg');
  });

  it('uses what was used last in this folder, and the toggle over that', () => {
    const memory = { [XPERT_KEY]: { account: '365', locked: false } } as const;

    expect(model({ projectKey: XPERT_KEY }, memory).account).toBe('365');
    expect(model({ projectKey: XPERT_KEY, account: 'isg' }, memory).account).toBe('isg');
  });

  it('holds a locked folder to its account whatever the toggle says', () => {
    const memory = { [APOLLO_KEY]: { account: '365', locked: true } } as const;
    const locked = model({ projectKey: APOLLO_KEY, account: 'isg', prompt: 'go' }, memory);

    expect(locked.locked).toBe(true);
    expect(locked.account).toBe('365');
    expect(locked.launch()?.profileFn).toBe('claude-365');
  });

  it('says every launch bypasses permissions, naming the function', () => {
    expect(model({ projectKey: XPERT_KEY }).bypassNotice).toBe(
      'claude-isg runs with --dangerously-skip-permissions',
    );
  });
});

describe('StartLauncherViewModel — skills and agents', () => {
  it('offers skills and commands by their scoped names, sorted', () => {
    expect(model({ projectKey: XPERT_KEY }).skills.map((each) => each.name)).toEqual([
      'design-check',
      'ship',
      'superpowers:brainstorming',
    ]);
  });

  it('offers only the agents core would accept, with their descriptions', () => {
    const agents = model({ projectKey: XPERT_KEY }).agents;

    expect(agents).toEqual([
      { kind: 'agent', name: 'code-reviewer', description: 'Reviews a diff.' },
    ]);
  });

  it('offers nothing for a folder whose map has not arrived', () => {
    expect(model({ projectKey: APOLLO_KEY }).skills).toEqual([]);
    expect(model({ projectKey: APOLLO_KEY }).agents).toEqual([]);
  });
});

describe('StartLauncherViewModel — what Start sends', () => {
  const SHIP = { kind: 'skill', name: 'ship', description: undefined } as const;
  const REVIEWER = { kind: 'agent', name: 'code-reviewer', description: undefined } as const;

  it('sends a skill alone as its slash command', () => {
    const launch = model({ projectKey: XPERT_KEY, starter: SHIP }).launch();

    expect(launch).toEqual({
      profileFn: 'claude-isg',
      prompt: '/ship',
      name: 'xpert-new-0927-0905',
      cwd: XPERT,
      agent: undefined,
    });
  });

  it('puts what was typed after the skill', () => {
    const typed = model({ projectKey: XPERT_KEY, starter: SHIP, prompt: '  P10-T2 ' });

    expect(typed.prompt).toBe('/ship P10-T2');
  });

  it('sends an agent as --agent, and needs a prompt for it', () => {
    expect(model({ projectKey: XPERT_KEY, starter: REVIEWER }).missing).toBe(
      'Say what the agent should do',
    );
    const launch = model({ projectKey: XPERT_KEY, starter: REVIEWER, prompt: 'review main' });

    expect(launch.launch()?.agent).toBe('code-reviewer');
    expect(launch.launch()?.prompt).toBe('review main');
  });

  it('needs a prompt when there is neither', () => {
    expect(model({ projectKey: XPERT_KEY }).missing).toBe('Pick a skill, or type a prompt');
  });

  it('uses a typed name over the suggestion', () => {
    const named = model({ projectKey: XPERT_KEY, prompt: 'go', name: ' morning ' });

    expect(named.launch()?.name).toBe('morning');
  });
});

describe('parseMemories', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const raw = JSON.stringify({
      a: { account: '365', locked: true },
      b: { account: 'other', locked: true },
      c: { account: 'isg' },
      d: 'isg',
    });

    expect(parseMemories(raw)).toEqual({ a: { account: '365', locked: true } });
  });

  it.each([undefined, '', 'not json', '[1]', 'null'])('reads %j as nothing', (raw) => {
    expect(parseMemories(raw)).toEqual({});
  });
});
