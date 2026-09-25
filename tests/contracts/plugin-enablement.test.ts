// `enabledPlugins` precedence, as code.claude.com/docs/en/plugins/loading documents it: key by
// key, local over project over user, and an id nobody mentions on (`defaultEnabled` is `true`).
import { describe, expect, it } from 'vitest';
import { pluginEnabled, type PluginSettingsLayers } from '../../contracts/plugin-enablement.ts';

const ID = 'shell-review@claude-kit';

function says(value: unknown): unknown {
  return { enabledPlugins: { [ID]: value } };
}

function layers(overrides: Partial<PluginSettingsLayers>): PluginSettingsLayers {
  return { user: undefined, project: undefined, local: undefined, ...overrides };
}

describe('pluginEnabled', () => {
  it('is on when no source mentions the id', () => {
    expect(pluginEnabled(ID, layers({}))).toBe(true);
    expect(pluginEnabled(ID, layers({ user: { enabledPlugins: { 'x@m': false } } }))).toBe(true);
  });

  it('takes the user value when it is the only one', () => {
    expect(pluginEnabled(ID, layers({ user: says(false) }))).toBe(false);
    expect(pluginEnabled(ID, layers({ user: says(true) }))).toBe(true);
  });

  it('lets project override user, both ways', () => {
    expect(pluginEnabled(ID, layers({ user: says(true), project: says(false) }))).toBe(false);
    expect(pluginEnabled(ID, layers({ user: says(false), project: says(true) }))).toBe(true);
  });

  it('lets local override project and user, both ways', () => {
    expect(
      pluginEnabled(ID, layers({ user: says(true), project: says(true), local: says(false) })),
    ).toBe(false);
    expect(
      pluginEnabled(ID, layers({ user: says(false), project: says(false), local: says(true) })),
    ).toBe(true);
  });

  it('falls through a source that is silent, malformed, or not boolean for the id', () => {
    const lower = { user: says(false) };
    expect(pluginEnabled(ID, layers({ ...lower, project: says('yes'), local: says(1) }))).toBe(
      false,
    );
    expect(pluginEnabled(ID, layers({ ...lower, project: 'not an object', local: [] }))).toBe(
      false,
    );
    expect(pluginEnabled(ID, layers({ ...lower, local: { enabledPlugins: [ID] } }))).toBe(false);
  });

  it('matches the whole id, not the plugin name alone', () => {
    const user = { enabledPlugins: { 'shell-review': false, 'shell-review@other': false } };
    expect(pluginEnabled(ID, layers({ user }))).toBe(true);
  });
});
