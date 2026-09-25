// Scaffolding for the two `PluginAssetReader` test files — split for `max-lines`, the way
// `spend-ledger-harness.ts` was. The door is the REAL `ReadPolicy` (see plugin-asset-reader.test.ts).
import { ClaudeAssetReader } from '../../../core/application/claude-asset-reader.ts';
import { PluginAssetReader } from '../../../core/application/plugin-asset-reader.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import type { ProjectPaths } from '../../../core/application/git-directory-locator.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import type { FakeProjectFiles } from '../../fakes/fake-project-files.ts';

export const C365 = 'C:\\Users\\dev\\.claude-365';
export const ISG = 'C:\\Users\\dev\\.claude-isg';
export const HERE = 'C:\\Users\\dev\\Documents\\development\\app-next';
export const ELSEWHERE = 'C:\\Users\\dev\\Documents\\development\\energy';

/** `ProjectRegistry.resolve` with canonicalisation as the identity: the policy decides alone. */
export class PolicyPaths implements ProjectPaths {
  public readonly refused: string[] = [];
  private readonly policy = new ReadPolicy([C365, ISG]);

  public resolve(path: string): Promise<Result<string, string>> {
    const refusal = this.policy.refusal(path);
    if (refusal === undefined) return Promise.resolve(ok(path));
    this.refused.push(path);
    return Promise.resolve(err(refusal));
  }
}

export function install(configDir: string, marketplace: string, plugin: string): string {
  return [configDir, 'plugins', 'cache', marketplace, plugin, '1.0.0'].reduce(childPath);
}

export function index(
  files: FakeProjectFiles,
  configDir: string,
  plugins: Record<string, unknown>,
): void {
  files.file(
    childPath(childPath(configDir, 'plugins'), 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins }),
    7,
  );
}

export function head(name: string, description = 'does a thing'): string {
  return ['---', `name: ${name}`, `description: ${description}`, '---', 'body'].join('\n');
}

export function skill(files: FakeProjectFiles, root: string, name: string): void {
  const skills = childPath(root, 'skills');
  files.directory(skills, [name]);
  files.file(childPath(childPath(skills, name), 'SKILL.md'), head(name));
}

export function agent(files: FakeProjectFiles, root: string, name: string): void {
  const agents = childPath(root, 'agents');
  files.directory(agents, [`${name}.md`, 'README.txt']);
  files.file(childPath(agents, `${name}.md`), head(name));
}

export function reader(
  files: FakeProjectFiles,
  paths: ProjectPaths = new PolicyPaths(),
): PluginAssetReader {
  return new PluginAssetReader({
    paths,
    files,
    assets: new ClaudeAssetReader({ paths, files }),
    configDirs: [C365, ISG],
  });
}

/** `$CFG\settings.json` with this `enabledPlugins`. */
export function userSettings(
  files: FakeProjectFiles,
  configDir: string,
  enabled: Record<string, unknown>,
  modifiedAt = 0,
): void {
  files.file(
    childPath(configDir, 'settings.json'),
    JSON.stringify({ enabledPlugins: enabled }),
    modifiedAt,
  );
}

/** `shell-review` with one agent, installed at user scope on the 365 config dir. */
export function shellReview(files: FakeProjectFiles, configDir = C365): void {
  const shell = install(configDir, 'claude-kit', 'shell-review');
  index(files, configDir, { 'shell-review@claude-kit': [{ scope: 'user', installPath: shell }] });
  agent(files, shell, 'bash-script-auditor');
}

export const ID = 'shell-review@claude-kit';
