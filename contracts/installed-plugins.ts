// Which plugins a config directory has installed, and where — P9-T5, SEC-FS-1.
//
// `$CFG\plugins\installed_plugins.json` is the one file that answers "what is installed" rather
// than "what exists". Its sibling `plugins\marketplaces\` holds a clone of every marketplace the
// owner has added — every plugin ever published to it — and reading that would list skills nobody
// can run. So this file is the index and the cache directory it points into is the content;
// nothing else under `plugins\` is read (read-policy.ts).
//
// **The shape, as measured on both config dirs (Claude Code, 2026-09-25):** `version: 2` and a
// `plugins` object keyed `<plugin>@<marketplace>`, each holding a list of installs with `scope`,
// `installPath`, `version` and — for `project` scope — the `projectPath` it was installed for.
// `fixtures/plugins/installed-plugins.json` is that file, scrubbed.
//
// **Scope decides which projects an install belongs to.** `user` is every project on the machine;
// `project` and `local` are the ONE folder named by `projectPath` (code.claude.com/docs/en/plugins,
// "Understand install scopes"). The owner's `superpowers` is `project`-scoped to a folder that is
// not imported, so it must not appear on the three that are — a skill drawn where it cannot run is
// a press that sends a sentence beginning with a slash.
//
// **The plugin's name is the key's first half**, not `plugin.json`'s `name`. The two agree in every
// install measured, and reading the manifest would be a second `.json` per plugin through a policy
// whose whole point is that `.json` is named one file at a time.
//
// Pure parsing, no IO: `PluginAssetReader` opens the file, and this is tested with a string.
import { PLUGIN_SHAPE } from './claude-assets.ts';
import { projectKey } from './project.ts';

/** Where the index lives under a config directory — the one `.json` SEC-FS-1 names for it. */
export const INSTALLED_PLUGINS_PATH = ['plugins', 'installed_plugins.json'] as const;

/** Measured at 3 KB with six plugins; this is room for two orders of magnitude more. */
export const MAX_INSTALLED_PLUGINS_BYTES = 256 * 1024;

/** How many installs one file may contribute — the bound on how many directories a map lists. */
const MAX_INSTALLS = 64;

/** A path Windows could hold. Longer is not a path this build will compose anything under. */
const MAX_PATH_CHARS = 1024;

/** The three scopes the docs name. An unknown one is dropped: its reach is unknowable. */
export const PLUGIN_SCOPES = ['user', 'project', 'local'] as const;

export type PluginScope = (typeof PLUGIN_SCOPES)[number];

export interface PluginInstall {
  /** `superpowers` — the prefix of every scoped name the plugin's assets carry. `PLUGIN_SHAPE`. */
  readonly plugin: string;
  readonly scope: PluginScope;
  /** The folder a `project` or `local` install was made for; `undefined` for `user`. */
  readonly projectPath: string | undefined;
  /** `<cfg>\plugins\cache\<marketplace>\<plugin>\<version>` — screened again before any read. */
  readonly installPath: string;
}

/**
 * Every install the file records that this build can use, in file order.
 *
 * An entry with a plugin name that is not `PLUGIN_SHAPE`, an unknown scope, a `project` scope with
 * no `projectPath`, or no `installPath` is dropped rather than guessed at.
 *
 * @throws never.
 */
export function parseInstalledPlugins(value: unknown): readonly PluginInstall[] {
  const plugins = record(record(value)?.['plugins']);
  if (plugins === undefined) return [];
  const installs: PluginInstall[] = [];
  for (const [key, entries] of Object.entries(plugins)) {
    const plugin = key.split('@')[0] ?? '';
    if (!PLUGIN_SHAPE.test(plugin) || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      const install = installOf(plugin, entry);
      if (install !== undefined) installs.push(install);
    }
  }
  return installs.slice(0, MAX_INSTALLS);
}

/**
 * Whether an install's assets are loaded in a session started in this project.
 *
 * @param projectPaths the project's stored path and its resolved root — both, because the owner
 * imported one spelling and Claude Code recorded whichever the install was run from. Compared by
 * `projectKey`, so case and separators do not decide it.
 */
export function installAppliesTo(install: PluginInstall, projectPaths: readonly string[]): boolean {
  if (install.scope === 'user') return true;
  const wanted = install.projectPath;
  if (wanted === undefined) return false;
  return projectPaths.some((path) => projectKey(path) === projectKey(wanted));
}

function installOf(plugin: string, value: unknown): PluginInstall | undefined {
  const fields = record(value);
  if (fields === undefined) return undefined;
  const scope = PLUGIN_SCOPES.find((known) => known === fields['scope']);
  const installPath = path(fields['installPath']);
  if (scope === undefined || installPath === undefined) return undefined;
  const projectPath = path(fields['projectPath']);
  if (scope !== 'user' && projectPath === undefined) return undefined;
  return { plugin, scope, projectPath: scope === 'user' ? undefined : projectPath, installPath };
}

function path(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value.length <= MAX_PATH_CHARS
    ? value
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
