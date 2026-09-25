// What a project gets from its installed plugins — P9-T5.
//
// The door is the REAL `ReadPolicy`, not a fake that allows everything under a root: the point of
// the task's security note is that only the index and three asset shapes under `plugins\cache\`
// are opened, and a fake policy would agree with any bug in the real one (G.26's lesson).
import { describe, expect, it } from 'vitest';
import { NO_PROJECT_SETTINGS } from '../../../contracts/plugin-enablement.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import {
  C365,
  ELSEWHERE,
  HERE,
  ISG,
  PolicyPaths,
  agent,
  head,
  index,
  install,
  reader,
  skill,
} from './plugin-asset-harness.ts';

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

    const assets = await reader(files).assets([HERE], NO_PROJECT_SETTINGS);

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

    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toEqual([]);
    expect(await reader(files).assets([HERE, ELSEWHERE], NO_PROJECT_SETTINGS)).toHaveLength(1);
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

    const assets = await reader(files).assets([HERE], NO_PROJECT_SETTINGS);

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

    expect(await reader(files, paths).assets([HERE], NO_PROJECT_SETTINGS)).toEqual([]);
    // Refused at the directory, so nothing under any of the three was ever listed or opened.
    expect(files.listed).toEqual([]);
    expect(paths.refused).toContain(childPath(clone, 'skills'));
  });

  it('answers nothing for an index that is absent, or is not JSON', async () => {
    const files = new FakeProjectFiles();
    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toEqual([]);
    files.file(childPath(childPath(C365, 'plugins'), 'installed_plugins.json'), '{ "plugins": ');
    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toEqual([]);
  });
});

describe('PluginAssetReader.signature', () => {
  it('moves when an index is rewritten, and reads 0 for one that is not there', async () => {
    const files = new FakeProjectFiles();
    const subject = reader(files);
    expect(await subject.signature()).toBe('0:0:0:0');

    index(files, ISG, {});
    const before = await subject.signature();
    files.touch(childPath(childPath(ISG, 'plugins'), 'installed_plugins.json'), 99);

    expect(before).toMatch(/^0:0:7\./u);
    expect(await subject.signature()).not.toBe(before);
  });
});
