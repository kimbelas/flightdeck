// Plugin enablement on the map — the gap P9-T5 left open. A plugin installed and then switched off
// in `enabledPlugins` must not be drawn, and the switch must move the map without waiting for the
// TTL, wherever it was written: the project's two files or the config dir's `settings.json`.
// Precedence itself is `tests/contracts/plugin-enablement.test.ts`'s.
import { beforeEach, describe, expect, it } from 'vitest';
import { childPath } from '../../../contracts/windows-path.ts';
import {
  APP,
  C365,
  build,
  installPlugins,
  populate,
  record,
  type Harness,
} from './workflow-map-harness.ts';

let harness: Harness;

beforeEach(() => {
  harness = build([record(APP)]);
});

describe('readAll and enabledPlugins', () => {
  it("leaves off a plugin the project's settings.json switches off", async () => {
    populate(harness.files);
    installPlugins(harness.files);
    harness.files.file(
      childPath(childPath(APP, '.claude'), 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': false } }),
    );
    const [map] = await harness.reader.readAll();
    expect(map?.assets.map((asset) => asset.name)).toEqual(['german-ui-expert']);
  });

  it('leaves off a plugin settings.local.json opts out of, over the project enabling it', async () => {
    populate(harness.files);
    installPlugins(harness.files);
    const claude = childPath(APP, '.claude');
    harness.files.file(
      childPath(claude, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }),
    );
    harness.files.file(
      childPath(claude, 'settings.local.json'),
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': false } }),
    );
    const [map] = await harness.reader.readAll();
    expect(map?.assets.map((asset) => asset.name)).toEqual(['german-ui-expert']);
  });

  it('re-reads when settings.local.json is written, which moves neither .claude nor settings.json', async () => {
    populate(harness.files);
    installPlugins(harness.files);
    const local = childPath(childPath(APP, '.claude'), 'settings.local.json');
    harness.files.file(local, '{}', 30);
    expect((await harness.reader.readAll())[0]?.assets).toHaveLength(2);
    harness.files.file(
      local,
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': false } }),
      31,
    );
    expect((await harness.reader.readAll())[0]?.assets).toHaveLength(1);
  });

  it('re-reads when a plugin is disabled at user scope, in $CFG\\settings.json', async () => {
    populate(harness.files);
    installPlugins(harness.files);
    expect((await harness.reader.readAll())[0]?.assets).toHaveLength(2);
    harness.files.file(
      childPath(C365, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': false } }),
      40,
    );
    expect((await harness.reader.readAll())[0]?.assets).toHaveLength(1);
  });
});
