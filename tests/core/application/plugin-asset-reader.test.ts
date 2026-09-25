// What a project gets from its installed plugins — P9-T5.
//
// The door is the REAL `ReadPolicy`, not a fake that allows everything under a root: the point of
// the task's security note is that only the index and three asset shapes under `plugins\cache\`
// are opened, and a fake policy would agree with any bug in the real one (G.26's lesson).
import { describe, expect, it } from 'vitest';
import { ClaudeAssetReader } from '../../../core/application/claude-asset-reader.ts';
import { PluginAssetReader } from '../../../core/application/plugin-asset-reader.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import type { ProjectPaths } from '../../../core/application/git-directory-locator.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';

const C365 = 'C:\\Users\\dev\\.claude-365';
const ISG = 'C:\\Users\\dev\\.claude-isg';
const HERE = 'C:\\Users\\dev\\Documents\\development\\app-next';
const ELSEWHERE = 'C:\\Users\\dev\\Documents\\development\\energy';

/** `ProjectRegistry.resolve` with canonicalisation as the identity: the policy decides alone. */
class PolicyPaths implements ProjectPaths {
  public readonly refused: string[] = [];
  private readonly policy = new ReadPolicy([C365, ISG]);

  public resolve(path: string): Promise<Result<string, string>> {
    const refusal = this.policy.refusal(path);
    if (refusal === undefined) return Promise.resolve(ok(path));
    this.refused.push(path);
    return Promise.resolve(err(refusal));
  }
}

function install(configDir: string, marketplace: string, plugin: string): string {
  return [configDir, 'plugins', 'cache', marketplace, plugin, '1.0.0'].reduce(childPath);
}

function index(files: FakeProjectFiles, configDir: string, plugins: Record<string, unknown>): void {
  files.file(
    childPath(childPath(configDir, 'plugins'), 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins }),
    7,
  );
}

function head(name: string, description = 'does a thing'): string {
  return ['---', `name: ${name}`, `description: ${description}`, '---', 'body'].join('\n');
}

function skill(files: FakeProjectFiles, root: string, name: string): void {
  const skills = childPath(root, 'skills');
  files.directory(skills, [name]);
  files.file(childPath(childPath(skills, name), 'SKILL.md'), head(name));
}

function agent(files: FakeProjectFiles, root: string, name: string): void {
  const agents = childPath(root, 'agents');
  files.directory(agents, [`${name}.md`, 'README.txt']);
  files.file(childPath(agents, `${name}.md`), head(name));
}

function reader(files: FakeProjectFiles, paths = new PolicyPaths()): PluginAssetReader {
  return new PluginAssetReader({
    paths,
    files,
    assets: new ClaudeAssetReader({ paths, files }),
    configDirs: [C365, ISG],
  });
}

describe('PluginAssetReader.assets', () => {
  it("lists a user install's skills and agents, each carrying its plugin", async () => {
    const files = new FakeProjectFiles();
    const shell = install(C365, 'claude-kit', 'shell-review');
    const powers = install(C365, 'claude-plugins-official', 'superpowers');
    index(files, C365, {
      'superpowers@claude-plugins-official': [{ scope: 'user', installPath: powers }],
      'shell-review@claude-kit': [{ scope: 'user', installPath: shell }],
    });
    agent(files, shell, 'bash-script-auditor');
    skill(files, powers, 'brainstorming');

    const assets = await reader(files).assets([HERE]);

    // Sorted by plugin, so `shell-review` comes first whatever order the index held.
    expect(assets.map((asset) => [asset.kind, asset.plugin, asset.name])).toEqual([
      ['agent', 'shell-review', 'bash-script-auditor'],
      ['skill', 'superpowers', 'brainstorming'],
    ]);
  });

  it('lists a project install only in the folder it was installed for', async () => {
    const files = new FakeProjectFiles();
    const powers = install(C365, 'claude-plugins-official', 'superpowers');
    index(files, C365, {
      'superpowers@claude-plugins-official': [
        { scope: 'project', projectPath: ELSEWHERE, installPath: powers },
      ],
    });
    skill(files, powers, 'brainstorming');

    expect(await reader(files).assets([HERE])).toEqual([]);
    expect(await reader(files).assets([HERE, ELSEWHERE])).toHaveLength(1);
  });

  it('counts a plugin installed on both config dirs once, the first dir winning', async () => {
    const files = new FakeProjectFiles();
    const on365 = install(C365, 'claude-kit', 'shell-review');
    const onIsg = install(ISG, 'claude-kit', 'shell-review');
    index(files, C365, { 'shell-review@claude-kit': [{ scope: 'user', installPath: on365 }] });
    index(files, ISG, { 'shell-review@claude-kit': [{ scope: 'user', installPath: onIsg }] });
    agent(files, on365, 'bash-script-auditor');
    files.directory(childPath(onIsg, 'agents'), ['bash-script-auditor.md']);
    files.file(
      childPath(childPath(onIsg, 'agents'), 'bash-script-auditor.md'),
      head('bash-script-auditor', 'the isg copy'),
    );

    const assets = await reader(files).assets([HERE]);

    expect(assets).toHaveLength(1);
    expect(assets[0]?.description).toBe('does a thing');
  });

  it('reads nothing an install points at outside plugins\\cache — the marketplaces included', async () => {
    const files = new FakeProjectFiles();
    const clone = [C365, 'plugins', 'marketplaces', 'claude-plugins-official', 'x', '1.0.0'].reduce(
      childPath,
    );
    const daemon = childPath(C365, 'daemon');
    index(files, C365, {
      'x@claude-plugins-official': [{ scope: 'user', installPath: clone }],
      'y@local': [{ scope: 'user', installPath: daemon }],
      'z@local': [{ scope: 'user', installPath: HERE }],
    });
    skill(files, clone, 'published-but-not-installed');
    skill(files, daemon, 'not-a-plugin');
    skill(files, HERE, 'not-a-plugin-either');
    const paths = new PolicyPaths();

    expect(await reader(files, paths).assets([HERE])).toEqual([]);
    // Refused at the directory, so nothing under any of the three was ever listed or opened.
    expect(files.listed).toEqual([]);
    expect(paths.refused).toContain(childPath(clone, 'skills'));
  });

  it('answers nothing for an index that is absent, or is not JSON', async () => {
    const files = new FakeProjectFiles();
    expect(await reader(files).assets([HERE])).toEqual([]);
    files.file(childPath(childPath(C365, 'plugins'), 'installed_plugins.json'), '{ "plugins": ');
    expect(await reader(files).assets([HERE])).toEqual([]);
  });
});

describe('PluginAssetReader.signature', () => {
  it('moves when an index is rewritten, and reads 0 for one that is not there', async () => {
    const files = new FakeProjectFiles();
    const subject = reader(files);
    expect(await subject.signature()).toBe('0:0');

    index(files, ISG, {});
    const before = await subject.signature();
    files.touch(childPath(childPath(ISG, 'plugins'), 'installed_plugins.json'), 99);

    expect(before).toMatch(/^0:7\./u);
    expect(await subject.signature()).not.toBe(before);
  });
});
