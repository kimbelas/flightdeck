// The agents, commands and skills a project gets from its installed plugins — P9-T5, SEC-FS-1.
//
// The map listed plugin NAMES (`enabledPlugins`) and nothing they carry, while the skills the owner
// has in numbers are plugin skills — `superpowers` alone is fifteen. This is the other half: for
// each config directory, `plugins\installed_plugins.json` says which plugins are installed and
// where, and the install directory under `plugins\cache\` holds `agents/*.md`, `commands/*.md` and
// `skills/*/SKILL.md` — the three shapes a project's own `.claude` has. So the walk IS
// `ClaudeAssetReader`'s, pointed at the install directory, and each asset comes back carrying its
// plugin (`ClaudeAsset.plugin`), which is what makes it `/<plugin>:<name>`.
//
// **Every path goes through the one door**, the config directory's own rules included: the index,
// the three directories and every head read are `resolve`d, which canonicalises and then asks
// `ReadPolicy`. The policy names the index and six patterns under `plugins\cache\` and nothing else
// (read-policy.ts), so an `installPath` pointing anywhere else — a plugin loaded from a folder, a
// path edited to point at `daemon\` — resolves to a refusal and contributes nothing. This class
// decides WHICH installs apply; it never decides what may be opened.
//
// **Which installs apply is the scope** (`installAppliesTo`): a `user` install everywhere, a
// `project` or `local` one only in the folder it was installed for.
//
// **Both config dirs, one list.** A project is not bound to a subscription — the same folder runs
// under either — so what a session there could load is the union. The same plugin installed on
// both contributes each asset once, the first config dir's copy winning; that is the order
// `configDirs` is given in, which is `SUBSCRIPTION_IDS`' order.
//
// **Enablement is not read.** `installed_plugins.json` is the source the task names; a plugin that
// is installed and then disabled in `enabledPlugins` still lists here. That is the known gap, and
// the ROADMAP notes carry it.
import {
  INSTALLED_PLUGINS_PATH,
  MAX_INSTALLED_PLUGINS_BYTES,
  installAppliesTo,
  parseInstalledPlugins,
  type PluginInstall,
} from '../../contracts/installed-plugins.ts';
import { scopedAssetName, type ClaudeAsset } from '../../contracts/claude-assets.ts';
import { childPath } from '../../contracts/windows-path.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { ProjectPaths } from './git-directory-locator.ts';

/** `ClaudeAssetReader.assets`, narrowed to the one call this makes. */
export interface InstallAssets {
  assets(directory: string): Promise<readonly ClaudeAsset[]>;
}

export interface PluginAssetParts {
  readonly paths: ProjectPaths;
  readonly files: ProjectFiles;
  readonly assets: InstallAssets;
  /** Both config directories, in the order their copies should win. */
  readonly configDirs: readonly string[];
}

export class PluginAssetReader {
  private readonly parts: PluginAssetParts;

  constructor(parts: PluginAssetParts) {
    this.parts = parts;
  }

  /**
   * Every plugin asset a session in this project could load, sorted by plugin, then as read.
   *
   * @param projectPaths the project's stored path and its resolved root (`installAppliesTo`).
   */
  public async assets(projectPaths: readonly string[]): Promise<readonly ClaudeAsset[]> {
    const installs = (await this.installs()).filter((install) =>
      installAppliesTo(install, projectPaths),
    );
    const read = await Promise.all(installs.map((install) => this.installAssets(install)));
    const unique = new Map<string, ClaudeAsset>();
    for (const asset of read.flat()) {
      const key = `${asset.kind}|${scopedAssetName(asset)}`;
      if (!unique.has(key)) unique.set(key, asset);
    }
    // `sort` is stable, so within a plugin the reader's own order — agents, commands, skills — holds.
    return [...unique.values()].sort(byPlugin);
  }

  /**
   * The index files' mtimes and sizes, for the map's cache signature.
   *
   * Installing, updating or removing a plugin rewrites the index, so the map moves on the next read
   * rather than when its five-minute TTL lapses.
   */
  public async signature(): Promise<string> {
    const facts = await Promise.all(
      this.parts.configDirs.map(async (configDir) => {
        const resolved = await this.parts.paths.resolve(indexPath(configDir));
        if (!resolved.ok) return '0';
        const found = await this.parts.files.facts(resolved.value);
        return found === undefined ? '0' : `${String(found.modifiedAt)}.${String(found.sizeBytes)}`;
      }),
    );
    return facts.join(':');
  }

  /** Every install either index records, in config-dir order. */
  private async installs(): Promise<readonly PluginInstall[]> {
    const lists = await Promise.all(
      this.parts.configDirs.map((configDir) => this.index(indexPath(configDir))),
    );
    return lists.flat();
  }

  /** One index, or `[]` for absent, refused and unparseable alike. */
  private async index(path: string): Promise<readonly PluginInstall[]> {
    const resolved = await this.parts.paths.resolve(path);
    if (!resolved.ok) return [];
    const text = await this.parts.files.read(resolved.value, MAX_INSTALLED_PLUGINS_BYTES);
    if (text === undefined) return [];
    try {
      return parseInstalledPlugins(JSON.parse(text));
    } catch {
      return [];
    }
  }

  /** One install's assets, each carrying its plugin. */
  private async installAssets(install: PluginInstall): Promise<readonly ClaudeAsset[]> {
    const assets = await this.parts.assets.assets(install.installPath);
    return assets.map((asset) => ({ ...asset, plugin: install.plugin }));
  }
}

function byPlugin(left: ClaudeAsset, right: ClaudeAsset): number {
  const a = left.plugin ?? '';
  const b = right.plugin ?? '';
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function indexPath(configDir: string): string {
  return INSTALLED_PLUGINS_PATH.reduce(childPath, configDir);
}
