// What the workflow-map panel decides before it draws — P3-T3, CODING-STANDARDS §3.
//
// The cases worth their place are the ones where a naive rendering would say something false: a
// count of zero drawn as "0 commands", a hook timeline re-sorted into a set, an absent file left
// off the stack so that "this repo has no CLAUDE.md" becomes unanswerable, and an MCP server whose
// badge leaked its command line.
import { describe, expect, it } from 'vitest';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import { WorkflowMapViewModel } from '../../app/deck/workflow-map-view-model.ts';

const MAP: WorkflowMap = {
  path: 'C:\\Users\\belas\\Documents\\development\\app-next',
  at: 1000,
  instructions: [
    { source: 'user-365', bytes: 683 },
    { source: 'user-isg', bytes: undefined },
    { source: 'claude-md', bytes: 3482 },
    { source: 'agents-md', bytes: undefined },
    { source: 'soul-md', bytes: 1_200_000 },
  ],
  assets: [
    {
      kind: 'agent',
      name: 'german-ui-expert',
      description: 'German label',
      model: 'inherit',
      tools: ['Read'],
    },
    { kind: 'command', name: 'design-check', description: undefined, model: undefined, tools: [] },
    { kind: 'skill', name: 'fix-review', description: 'one fetch', model: undefined, tools: [] },
  ],
  hooks: [
    {
      event: 'PostToolUse',
      matcher: 'Edit',
      condition: undefined,
      command: 'a',
      async: true,
      timeoutSeconds: undefined,
    },
    {
      event: 'PostToolUse',
      matcher: 'Edit',
      condition: 'Edit(scss)',
      command: 'b',
      async: false,
      timeoutSeconds: 20,
    },
    {
      event: 'Stop',
      matcher: undefined,
      condition: undefined,
      command: 'c',
      async: false,
      timeoutSeconds: 10,
    },
  ],
  servers: [{ name: 'chrome-devtools', transport: 'stdio' }],
  plugins: ['context-hygiene@claude-kit'],
  marketplaces: ['claude-kit'],
  permissions: {
    allow: ['Bash(git status:*)'],
    deny: ['Read(.env)'],
    ask: [],
    defaultMode: 'auto',
  },
  conventions: [
    { folder: 'rules', files: 6 },
    { folder: 'specs', files: 9 },
    { folder: 'state', files: 0 },
    { folder: 'maps', files: 0 },
    { folder: 'reference', files: 0 },
    { folder: 'prompts', files: 0 },
  ],
  worktrees: [
    {
      id: 'main',
      path: 'C:\\Users\\belas\\Documents\\development\\app-next',
      branch: 'main',
      isMain: true,
    },
    {
      id: 'XWEB-1853',
      path: 'C:\\Users\\belas\\Documents\\development\\app-next\\.claude\\worktrees\\XWEB-1853',
      branch: 'XWEB-1853',
      isMain: false,
    },
    {
      id: 'XWEB-1854',
      path: 'C:\\Users\\belas\\Documents\\development\\app-next\\.claude\\worktrees\\XWEB-1854',
      branch: 'feat/rework-the-picker',
      isMain: false,
    },
  ],
  gates: undefined,
  configured: true,
};

describe('before the first reply', () => {
  it('draws nothing at all', () => {
    const model = new WorkflowMapViewModel(undefined);
    expect(model.isKnown).toBe(false);
    expect(model.summary).toEqual([]);
    expect(model.instructions).toEqual([]);
  });
});

describe('summary', () => {
  it('says the shape of the config in one line', () => {
    expect(new WorkflowMapViewModel(MAP).summary).toEqual([
      '1 agent',
      '1 command',
      '1 skill',
      '3 hooks',
      '1 MCP server',
      '1 plugin',
      '1 allow rule',
      '1 deny rule',
    ]);
  });

  it('omits a count of zero rather than drawing a row of them', () => {
    const bare = { ...MAP, assets: [], hooks: [], servers: [], plugins: [] };
    expect(new WorkflowMapViewModel(bare).summary).toEqual(['1 allow rule', '1 deny rule']);
  });

  it('collapses to the sentence for a repository with no `.claude` — the P3 gate', () => {
    const docs: WorkflowMap = {
      ...MAP,
      assets: [],
      hooks: [],
      servers: [],
      plugins: [],
      marketplaces: [],
      permissions: { allow: [], deny: [], ask: [], defaultMode: undefined },
      configured: false,
    };
    const model = new WorkflowMapViewModel(docs);
    expect(model.summary).toEqual([]);
    expect(model.isConfigured).toBe(false);
    expect(model.emptyMessage).toContain('No .claude here');
  });
});

describe('instructions', () => {
  it('names every source and draws the gaps', () => {
    // "Does this repo have a CLAUDE.md at all" is the cross-project question the row is for, and a
    // list that omitted what is missing could not answer it.
    const lines = new WorkflowMapViewModel(MAP).instructions;
    expect(lines.map((line) => line.name)).toEqual([
      'user CLAUDE.md (365)',
      'user CLAUDE.md (isg)',
      'CLAUDE.md',
      'AGENTS.md',
      '.claude/soul.md',
    ]);
    expect(lines.find((line) => line.name === 'AGENTS.md')?.size).toBeUndefined();
  });

  it('says how much of the context window each file spends', () => {
    const sizes = new WorkflowMapViewModel(MAP).instructions.map((line) => line.size);
    expect(sizes).toEqual(['683 B', undefined, '3.5 kB', undefined, '1.2 MB']);
  });
});

describe('hookGroups', () => {
  it('groups by event without re-ordering anything', () => {
    // Claude Code runs a group's commands as written, and two `PostToolUse` entries where the
    // second depends on the first is a real configuration.
    const groups = new WorkflowMapViewModel(MAP).hookGroups;
    expect(groups.map((group) => group.event)).toEqual(['PostToolUse', 'Stop']);
    expect(groups[0]?.steps.map((step) => step.command)).toEqual(['a', 'b']);
  });

  it('starts a new group when the event changes back', () => {
    const interleaved: WorkflowMap = {
      ...MAP,
      hooks: [
        {
          event: 'Stop',
          matcher: undefined,
          condition: undefined,
          command: 'x',
          async: false,
          timeoutSeconds: undefined,
        },
        {
          event: 'PreToolUse',
          matcher: undefined,
          condition: undefined,
          command: 'y',
          async: false,
          timeoutSeconds: undefined,
        },
        {
          event: 'Stop',
          matcher: undefined,
          condition: undefined,
          command: 'z',
          async: false,
          timeoutSeconds: undefined,
        },
      ],
    };
    expect(new WorkflowMapViewModel(interleaved).hookGroups.map((group) => group.event)).toEqual([
      'Stop',
      'PreToolUse',
      'Stop',
    ]);
  });
});

describe('the rest of the rows', () => {
  it('names a server and how it is reached, never its command line', () => {
    expect(new WorkflowMapViewModel(MAP).servers).toEqual(['chrome-devtools (stdio)']);
  });

  it('puts `defaultMode` first, because it changes what the counts mean', () => {
    expect(new WorkflowMapViewModel(MAP).permissions).toBe('auto · 1 allow · 1 deny');
  });

  it('lists deny before allow on expand — the half doing the work', () => {
    expect(new WorkflowMapViewModel(MAP).permissionRules).toEqual([
      'Read(.env)',
      'Bash(git status:*)',
    ]);
  });

  it('counts only the convention folders that hold something', () => {
    expect(new WorkflowMapViewModel(MAP).conventions).toEqual(['rules 6', 'specs 9']);
  });
});

describe('the worktree row', () => {
  it('names every tree, main first', () => {
    expect(new WorkflowMapViewModel(MAP).worktrees).toEqual([
      'main',
      'XWEB-1853',
      'XWEB-1854 (feat/rework-the-picker)',
    ]);
  });

  it('gives the branch only when it differs from the id, which is the common case', () => {
    // A worktree is named after the ticket and checked out on a branch named after the same
    // ticket, so `XWEB-1853 (XWEB-1853)` is the row this rule exists to avoid.
    expect(new WorkflowMapViewModel(MAP).worktrees[1]).toBe('XWEB-1853');
  });

  it('says nothing for a repository with a single checkout', () => {
    const one = { ...MAP, worktrees: MAP.worktrees.slice(0, 1) };
    expect([
      new WorkflowMapViewModel(one).worktrees,
      new WorkflowMapViewModel(one).hasWorktrees,
    ]).toEqual([[], false]);
  });

  it('says nothing for a folder outside a repository', () => {
    expect(new WorkflowMapViewModel({ ...MAP, worktrees: [] }).worktrees).toEqual([]);
  });

  it('names which tree the imported folder itself is', () => {
    const model = new WorkflowMapViewModel(MAP);
    expect([model.currentTree, model.isMainTree]).toEqual(['main', true]);
  });

  it('knows when the imported folder is a linked worktree rather than the main checkout', () => {
    const here = { ...MAP, path: MAP.worktrees[1]?.path ?? '' };
    const model = new WorkflowMapViewModel(here);
    expect([model.currentTree, model.isMainTree]).toEqual(['XWEB-1853', false]);
  });

  it('keeps the worktrees out of the closed summary, which is about .claude', () => {
    // The P3 gate's second half: a folder with no `.claude` collapses to one sentence, and a
    // worktree count in the summary line would make it collapse to a count instead.
    expect(new WorkflowMapViewModel(MAP).summary.join(' ')).not.toContain('worktree');
  });
});
