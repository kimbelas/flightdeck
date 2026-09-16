// Walking a project's `.claude` — P3-T3, SEC-FS-1.
//
// **The case this file exists for is the one that shipped green last time.** `resolveRoot` checks
// registry MEMBERSHIP and `resolve` screens a path; only the ROOT is special, so
// `<root>\.claude\agents` goes through `resolve` like any other path (DECISIONS.md D37,
// RESEARCH.md G.26). A reader that reached for `resolveRoot` here would refuse every subdirectory
// and report a repository with 16 assets as having none — and 1 558 unit tests were green the last
// time that exact mistake was made, because the fake was looser than the collaborator.
//
// So `FakeProjectPaths` is used as it is: it canonicalises, then screens the RESULT against the
// roots, which is the order SEC-FS-1 depends on. The junction case is here for the same reason it
// is in `tests/win` — a `.claude\skills` that points out of the root must come back empty.
import { beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAssetReader } from '../../../core/application/claude-asset-reader.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

const ROOT = 'C:\\Users\\belas\\Documents\\development\\app-next';
const CLAUDE = childPath(ROOT, '.claude');

const AGENT = [
  '---',
  'name: german-ui-expert',
  'description: German label to source string.',
  '---',
];
const SKILL = ['---', 'name: fix-review', 'allowed-tools: Bash, Read', '---'];

let files: FakeProjectFiles;
let paths: FakeProjectPaths;
let reader: ClaudeAssetReader;

beforeEach(() => {
  files = new FakeProjectFiles();
  paths = new FakeProjectPaths().root(ROOT);
  reader = new ClaudeAssetReader({ paths, files });
});

/** `app-next`'s shape, trimmed: one of each kind, plus the noise a real folder carries. */
function populate(): void {
  files.directory(childPath(CLAUDE, 'agents'), ['german-ui-expert.md', 'README.txt']);
  files.file(childPath(childPath(CLAUDE, 'agents'), 'german-ui-expert.md'), AGENT.join('\n'));
  files.directory(childPath(CLAUDE, 'commands'), ['design-check.md']);
  files.file(
    childPath(childPath(CLAUDE, 'commands'), 'design-check.md'),
    ['---', 'description: Pre-MR DESIGN-FIT pass.', '---'].join('\n'),
  );
  files.directory(childPath(CLAUDE, 'skills'), ['fix-review']);
  const skill = childPath(childPath(CLAUDE, 'skills'), 'fix-review');
  files.directory(skill, ['SKILL.md', 'reference.md']);
  files.file(childPath(skill, 'SKILL.md'), SKILL.join('\n'));
}

describe('assets', () => {
  it('reads all three kinds out of one `.claude`', async () => {
    populate();
    const assets = await reader.assets(CLAUDE);
    expect(assets.map((asset) => `${asset.kind}:${asset.name}`)).toEqual([
      'agent:german-ui-expert',
      'command:design-check',
      'skill:fix-review',
    ]);
  });

  it('reads a skill one level down, at `SKILL.md`', async () => {
    populate();
    const skill = (await reader.assets(CLAUDE)).find((asset) => asset.kind === 'skill');
    expect(skill?.tools).toEqual(['Bash', 'Read']);
  });

  it('ignores a file that is not markdown — a README is not a subagent', async () => {
    populate();
    expect(await reader.assets(CLAUDE)).toHaveLength(3);
  });

  it('names a command by its filename when the file does not', async () => {
    populate();
    const command = (await reader.assets(CLAUDE)).find((asset) => asset.kind === 'command');
    expect(command?.name).toBe('design-check');
  });

  it('screens every subdirectory through `resolve`, not the root door', async () => {
    populate();
    await reader.assets(CLAUDE);
    // The asymmetry D37 named: only the root is answered by `resolveRoot`, and everything under it
    // — including a directory — is screened as a path (RESEARCH.md G.26).
    expect(paths.asked).toContain(childPath(CLAUDE, 'agents'));
    expect(paths.asked).toContain(childPath(childPath(CLAUDE, 'agents'), 'german-ui-expert.md'));
  });

  it('answers nothing for a `.claude` that a junction points out of the root', async () => {
    populate();
    paths.junction(childPath(CLAUDE, 'skills'), 'C:\\Users\\belas\\.claude-365\\plugins');
    const assets = await reader.assets(CLAUDE);
    expect(assets.some((asset) => asset.kind === 'skill')).toBe(false);
  });

  it('answers nothing for a folder with no `.claude` at all', async () => {
    expect(await reader.assets(CLAUDE)).toEqual([]);
  });
});

describe('conventions', () => {
  it('counts all six folders, present or not', async () => {
    files.directory(childPath(CLAUDE, 'rules'), ['a.md', 'b.md', 'c.md']);
    files.directory(childPath(CLAUDE, 'state'), ['in-flight.md']);
    const counted = await reader.conventions(CLAUDE);
    expect(counted).toEqual([
      { folder: 'rules', files: 3 },
      { folder: 'specs', files: 0 },
      { folder: 'state', files: 1 },
      { folder: 'maps', files: 0 },
      { folder: 'reference', files: 0 },
      { folder: 'prompts', files: 0 },
    ]);
  });

  it('counts zero rather than omitting a folder that is not there', async () => {
    // The cross-project question the row is for: which repos keep rules and specs, and which have
    // work in flight. A list that omitted the gaps could not answer it.
    expect(await reader.conventions(CLAUDE)).toHaveLength(6);
  });
});
