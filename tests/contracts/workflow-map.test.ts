// The aggregate and the instruction stack, over the wire — P3-T3, SPEC §5.1(a).
//
// The two cases doing real work are about ORDER being a property of this build rather than of
// whatever answered: a reply that lists the instruction sources backwards, or omits a convention
// folder, still draws in resolution order and still draws all six. That is what lets the panel
// render gaps — "this repo has no CLAUDE.md" is the answer the row exists to give, and a list that
// only carried what was present could not give it.
import { describe, expect, it } from 'vitest';
import { INSTRUCTION_SOURCES, parseInstructionStack } from '../../contracts/instruction-stack.ts';
import {
  CONVENTION_FOLDERS,
  parseWorkflowMap,
  parseWorkflowMapList,
} from '../../contracts/workflow-map.ts';

const MAP = {
  path: 'C:\\Users\\belas\\Documents\\development\\app-next',
  at: 1000,
  instructions: [
    { source: 'claude-md', bytes: 3482 },
    { source: 'user-365', bytes: 683 },
  ],
  assets: [{ kind: 'agent', name: 'german-ui-expert', tools: ['Read'] }],
  hooks: [{ event: 'PreCompact', command: 'node state-dump.mjs', timeout: 15 }],
  servers: [{ name: 'chrome-devtools', transport: 'stdio' }],
  plugins: ['context-hygiene@claude-kit'],
  marketplaces: ['claude-kit'],
  permissions: { allow: ['Bash(git status:*)'] },
  conventions: [{ folder: 'rules', files: 6 }],
  configured: true,
};

describe('parseInstructionStack', () => {
  it('answers every source in resolution order, however the reply was ordered', () => {
    const stack = parseInstructionStack(MAP.instructions);
    expect(stack.map((file) => file.source)).toEqual([...INSTRUCTION_SOURCES]);
  });

  it('reports an absent file as absent rather than as zero bytes', () => {
    // An empty `CLAUDE.md` somebody created and never filled in is a different thing from no
    // `CLAUDE.md`, and only one of the two is worth a nudge.
    const stack = parseInstructionStack([{ source: 'claude-md', bytes: 0 }]);
    expect(stack.find((file) => file.source === 'claude-md')?.bytes).toBe(0);
    expect(stack.find((file) => file.source === 'soul-md')?.bytes).toBeUndefined();
  });

  it('drops a source this build does not know', () => {
    const stack = parseInstructionStack([{ source: 'enterprise-md', bytes: 12 }]);
    expect(stack).toHaveLength(INSTRUCTION_SOURCES.length);
  });

  it('answers the full stack for a reply that carried none', () => {
    expect(parseInstructionStack(undefined)).toHaveLength(INSTRUCTION_SOURCES.length);
  });
});

describe('parseWorkflowMap', () => {
  it('reads the seven readings and the one flag', () => {
    const map = parseWorkflowMap(MAP);
    expect(map?.assets).toHaveLength(1);
    expect(map?.hooks).toHaveLength(1);
    expect(map?.servers).toEqual([{ name: 'chrome-devtools', transport: 'stdio' }]);
    expect(map?.plugins).toEqual(['context-hygiene@claude-kit']);
    expect(map?.permissions.allow).toEqual(['Bash(git status:*)']);
    expect(map?.configured).toBe(true);
  });

  it('answers all six convention folders, counting the absent ones zero', () => {
    const map = parseWorkflowMap(MAP);
    expect(map?.conventions.map((folder) => folder.folder)).toEqual([...CONVENTION_FOLDERS]);
    expect(map?.conventions.find((folder) => folder.folder === 'rules')?.files).toBe(6);
    expect(map?.conventions.find((folder) => folder.folder === 'specs')?.files).toBe(0);
  });

  it('refuses a reply with no path or no timestamp — there is no row to draw it on', () => {
    expect(parseWorkflowMap({ ...MAP, path: '' })).toBeUndefined();
    expect(parseWorkflowMap({ ...MAP, at: 'now' })).toBeUndefined();
    expect(parseWorkflowMap(undefined)).toBeUndefined();
  });

  it('degrades a folder with no `.claude` to empty lists rather than to a failure', () => {
    // `docs-tool` is the P3 gate's second half: a CLAUDE.md, a stack, a git, and nothing else.
    const bare = parseWorkflowMap({ path: 'C:\\docs-tool', at: 1, configured: false });
    expect(bare?.configured).toBe(false);
    expect(bare?.assets).toEqual([]);
    expect(bare?.hooks).toEqual([]);
    expect(bare?.conventions).toHaveLength(CONVENTION_FOLDERS.length);
    expect(bare?.instructions).toHaveLength(INSTRUCTION_SOURCES.length);
  });
});

describe('parseWorkflowMapList', () => {
  it('drops one unreadable map rather than the whole reply', () => {
    const maps = parseWorkflowMapList({ maps: [MAP, { path: '' }, { ...MAP, path: 'C:\\b' }] });
    expect(maps.map((map) => map.path)).toEqual([MAP.path, 'C:\\b']);
  });

  it('answers nothing for a body that is not a list', () => {
    expect(parseWorkflowMapList({ maps: 'none' })).toEqual([]);
    expect(parseWorkflowMapList(undefined)).toEqual([]);
  });
});
