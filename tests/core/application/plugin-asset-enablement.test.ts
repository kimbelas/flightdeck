// Which installed plugins are ENABLED for a project — the gap P9-T5 left open. Precedence, per
// code.claude.com/docs/en/plugins/loading ("Find where a plugin is enabled"): local over project
// over user, key by key, and an id nobody mentions on. Through the real `ReadPolicy`, like the rest.
import { describe, expect, it } from 'vitest';
import { NO_PROJECT_SETTINGS } from '../../../contracts/plugin-enablement.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import type { ProjectPaths } from '../../../core/application/git-directory-locator.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import { err, ok } from '../../../core/shared/result.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { C365, HERE, ID, ISG, reader, shellReview, userSettings } from './plugin-asset-harness.ts';

describe('PluginAssetReader.assets — enablement (code.claude.com/docs/en/plugins/loading)', () => {
  it('lists an install no enabledPlugins mentions: defaultEnabled is true', async () => {
    const files = new FakeProjectFiles();
    shellReview(files);
    userSettings(files, C365, { 'other@claude-kit': false });

    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toHaveLength(1);
  });

  it('drops an install the user settings switch off, and keeps one they switch on', async () => {
    const files = new FakeProjectFiles();
    shellReview(files);
    userSettings(files, C365, { [ID]: false });
    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toEqual([]);

    userSettings(files, C365, { [ID]: true });
    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toHaveLength(1);
  });

  it('lets the project settings override the user settings, either way', async () => {
    const files = new FakeProjectFiles();
    shellReview(files);
    userSettings(files, C365, { [ID]: true });
    const off = { project: { enabledPlugins: { [ID]: false } }, local: undefined };
    expect(await reader(files).assets([HERE], off)).toEqual([]);

    userSettings(files, C365, { [ID]: false });
    const on = { project: { enabledPlugins: { [ID]: true } }, local: undefined };
    expect(await reader(files).assets([HERE], on)).toHaveLength(1);
  });

  it('lets settings.local.json override the project, either way', async () => {
    const files = new FakeProjectFiles();
    shellReview(files);
    const optOut = {
      project: { enabledPlugins: { [ID]: true } },
      local: { enabledPlugins: { [ID]: false } },
    };
    expect(await reader(files).assets([HERE], optOut)).toEqual([]);

    userSettings(files, C365, { [ID]: false });
    const optIn = {
      project: { enabledPlugins: { [ID]: false } },
      local: { enabledPlugins: { [ID]: true } },
    };
    expect(await reader(files).assets([HERE], optIn)).toHaveLength(1);
  });

  it('falls through a source that does not mention the id, or says something not boolean', async () => {
    const files = new FakeProjectFiles();
    shellReview(files);
    userSettings(files, C365, { [ID]: false });
    const silent = {
      project: { enabledPlugins: { 'other@claude-kit': true } },
      local: { enabledPlugins: { [ID]: 'yes' } },
    };

    expect(await reader(files).assets([HERE], silent)).toEqual([]);
  });

  it('matches the whole id, so a namesake from another marketplace decides nothing', async () => {
    const files = new FakeProjectFiles();
    shellReview(files);
    userSettings(files, C365, { 'shell-review@elsewhere': false, 'shell-review': false });

    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toHaveLength(1);
  });

  it("reads each config dir's own user settings for that dir's installs", async () => {
    const files = new FakeProjectFiles();
    shellReview(files, C365);
    shellReview(files, ISG);
    userSettings(files, C365, { [ID]: false });
    userSettings(files, ISG, { [ID]: true });

    // Off under 365, on under isg: a session under isg loads it, so it lists once, isg's copy.
    const assets = await reader(files).assets([HERE], NO_PROJECT_SETTINGS);
    expect(assets).toHaveLength(1);

    userSettings(files, ISG, { [ID]: false });
    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toEqual([]);
  });

  it('treats a user settings.json that is not JSON as not mentioning anything', async () => {
    const files = new FakeProjectFiles();
    shellReview(files);
    files.file(childPath(C365, 'settings.json'), '{ "enabledPlugins": ');

    expect(await reader(files).assets([HERE], NO_PROJECT_SETTINGS)).toHaveLength(1);
  });
});

describe('PluginAssetReader.projectSettings', () => {
  it('reads settings.json and settings.local.json under .claude, each or neither', async () => {
    const files = new FakeProjectFiles();
    const claude = childPath(HERE, '.claude');
    const policy = new ReadPolicy([C365, ISG], [HERE]);
    const paths: ProjectPaths = {
      resolve: (path) => {
        const refusal = policy.refusal(path);
        return Promise.resolve(refusal === undefined ? ok(path) : err(refusal));
      },
    };
    const subject = reader(files, paths);
    expect(await subject.projectSettings(claude)).toEqual(NO_PROJECT_SETTINGS);

    files.file(
      childPath(claude, 'settings.json'),
      JSON.stringify({ enabledPlugins: { [ID]: true } }),
    );
    files.file(childPath(claude, 'settings.local.json'), '{ not json');
    expect(await subject.projectSettings(claude)).toEqual({
      project: { enabledPlugins: { [ID]: true } },
      local: undefined,
    });
  });
});

describe('PluginAssetReader.signature and enablement', () => {
  it('moves when a user settings.json is rewritten — an enable or disable at user scope', async () => {
    const files = new FakeProjectFiles();
    const subject = reader(files);
    userSettings(files, C365, { [ID]: true }, 5);
    const before = await subject.signature();
    userSettings(files, C365, { [ID]: false }, 6);

    expect(await subject.signature()).not.toBe(before);
  });
});
