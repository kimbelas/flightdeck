// What the presets section of a project row renders — P4-T1.
//
// Every case here is one the component cannot be asked about without a DOM, which is why the view
// model exists (CODING-STANDARDS §3). The two that matter most: **the subscription badge is
// derived from the profile function** rather than carried beside it, so it cannot disagree with
// the command line; and **`draftPrompt` shows what a half-typed ticket id would actually send**,
// which is what keeps the start button honest.
import { describe, expect, it } from 'vitest';
import {
  PRESET_REFUSALS,
  type LaunchPreset,
  type PresetRefusal,
} from '../../contracts/launch-preset.ts';
import { projectKey } from '../../contracts/project.ts';
import { draftPrompt, PresetsViewModel } from '../../app/deck/presets-view-model.ts';

const APP_NEXT = 'C:\\Users\\belas\\Documents\\development\\app-next';
const TREE = `${APP_NEXT}\\.claude\\worktrees\\XWEB-2019`;
const DOCS_TOOL = 'C:\\Users\\belas\\Documents\\development\\docs-tool';

function preset(over: Partial<LaunchPreset> = {}): LaunchPreset {
  return {
    projectKey: projectKey(APP_NEXT),
    id: 'ticket',
    name: 'ticket',
    profileFn: 'claude-isg-ticket',
    cwd: APP_NEXT,
    sessionName: 'XWEB-2019',
    promptSource: 'ticket',
    prompt: '',
    group: undefined,
    agent: undefined,
    builtIn: true,
    ...over,
  };
}

function model(presets: readonly LaunchPreset[], refusal?: PresetRefusal): PresetsViewModel {
  return new PresetsViewModel(presets, APP_NEXT, refusal);
}

describe('PresetsViewModel', () => {
  it('keeps only the presets filed under this project', () => {
    const other = preset({ projectKey: projectKey(DOCS_TOOL), id: 'elsewhere' });

    expect(model([preset(), other]).lines.map((line) => line.id)).toEqual(['ticket']);
  });

  it('is empty only before core has answered', () => {
    // Every imported project has four built-ins the moment core replies, so an empty section means
    // the request has not landed rather than "this folder has no presets".
    expect(model([]).isEmpty).toBe(true);
    expect(model([preset()]).isEmpty).toBe(false);
  });

  it('derives the subscription from the profile function', () => {
    const rows = model([
      preset({ id: '365', profileFn: 'claude-365' }),
      preset({ id: 'isg', profileFn: 'claude-isg' }),
      preset({ id: 'orch', profileFn: 'claude-isg-orch' }),
    ]).lines;

    expect(rows.map((line) => line.subscription)).toEqual(['365', 'isg', 'isg']);
  });

  it('says which preset’s name box is not the launcher’s', () => {
    // `claude-isg-orch` already passes `-n orchestrator`, so the launcher must not add a second.
    const rows = model([preset(), preset({ id: 'orch', profileFn: 'claude-isg-orch' })]).lines;

    expect(rows.map((line) => line.namesItself)).toEqual([false, true]);
  });

  it('calls the project root by its name rather than repeating the path', () => {
    const [line] = model([preset()]).lines;

    expect(line?.where).toBe('project root');
    expect(line?.isRoot).toBe(true);
  });

  it('shows a worktree as the part below the root', () => {
    const [line] = model([preset({ cwd: TREE })]).lines;

    expect(line?.where).toBe('.claude\\worktrees\\XWEB-2019');
    expect(line?.isRoot).toBe(false);
  });

  it('shows the whole path for a folder that is not under this root at all', () => {
    // Not dead: a saved preset keeps the cwd core resolved when it was saved, and the project can
    // be re-imported through a different junction. Showing the path beats showing nothing.
    const [line] = model([preset({ cwd: DOCS_TOOL })]).lines;

    expect(line?.where).toBe(DOCS_TOOL);
  });

  it('carries the prompt each preset would send', () => {
    const rows = model([
      preset(),
      preset({ id: 'nightly', promptSource: 'literal', prompt: 'read CLAUDE.md' }),
      preset({ id: 'empty', promptSource: 'literal', prompt: '' }),
    ]).lines;

    expect(rows[0]?.prompt).toContain('plan ticket XWEB-2019');
    expect(rows[1]?.prompt).toBe('read CLAUDE.md');
    // Nothing to send, which is what keeps the start button disabled (`--bg` needs a prompt).
    expect(rows[2]?.prompt).toBe('');
  });

  it('has nothing to say when the last save was taken', () => {
    expect(model([preset()]).problem).toBeUndefined();
  });

  it('turns every refusal core can send into a sentence, not the code spelled longer', () => {
    for (const refusal of PRESET_REFUSALS) {
      const problem = model([], refusal).problem ?? '';

      expect(problem.length).toBeGreaterThan(10);
      expect(problem).not.toContain(refusal);
    }
  });

  it('says what to do about the folder refusal, which is the one worth explaining', () => {
    expect(model([], 'bad_cwd').problem).toContain('worktree');
  });
});

describe('draftPrompt', () => {
  it('computes a ticket prompt from what is currently in the name box', () => {
    expect(draftPrompt('ticket', 'XWEB-7', 'ignored')).toContain('plan ticket XWEB-7');
  });

  it('answers nothing while the ticket id is still empty', () => {
    expect(draftPrompt('ticket', '', 'ignored')).toBe('');
  });

  it('answers what was typed for a literal preset', () => {
    expect(draftPrompt('literal', 'nightly', 'read CLAUDE.md')).toBe('read CLAUDE.md');
  });
});

describe('PresetsViewModel — the agent select (P9-T1)', () => {
  const withRoster = (
    presets: readonly LaunchPreset[],
    roster: readonly string[],
  ): PresetsViewModel => new PresetsViewModel(presets, APP_NEXT, undefined, { roster });

  it('offers the roster on a function that does not pin an agent', () => {
    const line = withRoster([preset()], ['code-reviewer', 'reviewer']).lines[0];

    expect(line?.agentChoices).toEqual(['code-reviewer', 'reviewer']);
    expect(line?.agent).toBeUndefined();
    expect(line?.pinsAgent).toBe(false);
  });

  it('offers nothing on claude-isg-orch, which runs its own agent', () => {
    const line = withRoster([preset({ profileFn: 'claude-isg-orch' })], ['reviewer']).lines[0];

    expect(line?.agentChoices).toEqual([]);
    expect(line?.pinsAgent).toBe(true);
  });

  it('keeps a saved agent the roster lost in the list, marked missing', () => {
    const line = withRoster([preset({ builtIn: false, agent: 'gone' })], ['reviewer']).lines[0];

    expect(line?.agentChoices).toEqual(['reviewer', 'gone']);
    expect(line?.agentMissing).toBe(true);
  });

  it('offers nothing before the map has arrived', () => {
    expect(model([preset()]).lines[0]?.agentChoices).toEqual([]);
  });
});

describe('PresetsViewModel — the ticket datalist (P9-T3)', () => {
  const TICKETS = ['XWEB-2126', 'XWEB-2113', 'XWEB-1830'];
  const withTickets = (presets: readonly LaunchPreset[]): PresetsViewModel =>
    new PresetsViewModel(presets, APP_NEXT, undefined, { tickets: TICKETS });

  it('offers the map ids, in its order, on a ticket preset', () => {
    expect(withTickets([preset()]).lines[0]?.ticketChoices).toEqual(TICKETS);
  });

  it('offers nothing on a literal preset, whose name box is a session name', () => {
    const line = withTickets([preset({ id: 'plain', promptSource: 'literal' })]).lines[0];

    expect(line?.ticketChoices).toEqual([]);
  });

  it('offers nothing before the map has arrived, or for a project with no specs', () => {
    expect(model([preset()]).lines[0]?.ticketChoices).toEqual([]);
  });

  it('still sends a typed id that is not on the list — the spec may be about to be written', () => {
    expect(withTickets([preset()]).lines[0]?.ticketChoices).not.toContain('XWEB-9999');
    expect(draftPrompt('ticket', 'xweb-9999', '')).toContain('.claude/specs/XWEB-9999/');
  });
});
