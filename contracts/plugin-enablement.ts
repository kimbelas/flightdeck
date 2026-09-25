// Whether an installed plugin is turned on for a project — the gap P9-T5 left open.
//
// `installed_plugins.json` says what is on disk; `enabledPlugins` says what a session LOADS. A
// plugin installed and then switched off (`claude plugin disable`, the `/plugin` Installed tab, or
// a `.claude/settings.local.json` opt-out) is still in the index, and listing its skills on the map
// would offer a press that sends a slash command Claude Code will not recognise.
//
// **The rule, as documented** — code.claude.com/docs/en/plugins/loading, "Find where a plugin is
// enabled": an entry is `"<name>@<marketplace>": true | false`, the sources merge KEY BY KEY, and
// "for each plugin id, the value that applies is the one from the highest-precedence source that
// mentions the id. A source that doesn't mention the id leaves the value from the lower-precedence
// source in effect." Of the six sources, the three this build reads are, lowest first, user
// (`$CFG\settings.json`), project (`.claude\settings.json`) and local (`.claude\settings.local.json`)
// — so local beats project beats user, per id. The other three are not read, and on purpose:
// `--add-dir` and `--settings` belong to one launch, not to the project, and no managed settings
// file exists on this machine.
//
// **An id NO source mentions is enabled.** code.claude.com/docs/en/plugins/manifest-reference,
// `defaultEnabled`: "Whether the plugin starts enabled when the user hasn't set it in
// `enabledPlugins`. Defaults to `true`." The manifest (or the marketplace entry) can say `false`,
// and that case is not seen here: `plugin.json` is refused by SEC-FS-1 (a plugin is a whole
// repository, and `.json` under a config dir is named one file at a time). Installing writes the
// entry anyway (plugins/install, "Choose an install scope"), so an unmentioned install is rare.
//
// A value that is not a boolean is treated as not mentioning the id — the documented shape is
// boolean, and a malformed entry should not hide a lower source's explicit answer.
//
// Pure, no IO: the readers hand over the parsed files.

/** The user source under a config dir and the project source under `.claude`: one name. */
export const SETTINGS_FILE = 'settings.json';

/** The project's own opt-out file, beside `settings.json` under `.claude`. */
export const LOCAL_SETTINGS_FILE = 'settings.local.json';

/** The two project-side sources, parsed — `undefined` (or anything) for absent or unreadable. */
export interface ProjectPluginSettings {
  /** `.claude\settings.json`, the committed one. */
  readonly project: unknown;
  /** `.claude\settings.local.json`, the one git does not track. */
  readonly local: unknown;
}

/** The three sources for one config dir, as parsed JSON. */
export interface PluginSettingsLayers extends ProjectPluginSettings {
  /** `$CFG\settings.json` of the config dir the install came from. */
  readonly user: unknown;
}

/** What a project with neither file answers. */
export const NO_PROJECT_SETTINGS: ProjectPluginSettings = { project: undefined, local: undefined };

/**
 * Whether the plugin `id` (`name@marketplace`, as `installed_plugins.json` keys it) loads.
 *
 * @throws never.
 */
export function pluginEnabled(id: string, layers: PluginSettingsLayers): boolean {
  // Highest precedence first; the first source that mentions the id decides.
  for (const settings of [layers.local, layers.project, layers.user]) {
    const value = enabledPlugins(settings)?.[id];
    if (typeof value === 'boolean') return value;
  }
  return true;
}

function enabledPlugins(settings: unknown): Readonly<Record<string, unknown>> | undefined {
  return record(record(settings)?.['enabledPlugins']);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
