// What is IN a project's `.claude/` — agents, commands, skills and the convention folders (P3-T3).
//
// Two of SPEC §5.1's rows and one class, because both are the same walk: list a directory under
// `.claude`, and either count what is in it or read the head of each file. Splitting them would
// mean two classes that resolve the same parent and hold the same three caps.
//
// **Listing, then one head read per file, and no recursion.** A skill is a directory with a
// `SKILL.md` in it and possibly a `reference.md`, a `scripts/` and a corpus of examples beside it;
// an agent is one file. So the walk is exactly two levels deep for skills and one for the rest,
// which is what the layout is, rather than a general tree walk bounded by a depth counter.
//
// **Every path goes through `resolve` — including the directories.** `ProjectRegistry.resolve`
// refuses only the ROOT itself ("the project directory itself is not a file"), so
// `<root>\.claude\agents` is screened like any other path under the root and is allowed by D36.
// The asymmetry is D37's and it is easy to get backwards: `resolveRoot` is for the root and checks
// registry MEMBERSHIP, so using it here would refuse every subdirectory (RESEARCH.md G.26).
//
// **What cannot be read is absent, never an error.** A `.claude` with no `agents/` in it, one on a
// drive that is not plugged in, and a `SKILL.md` that is a directory all produce no entries. The
// panel's job is to say what Claude is configured to do here; "nothing, as far as I can see" is
// the honest version of all three.
import {
  MAX_ASSET_HEAD_BYTES,
  parseAsset,
  type AssetKind,
  type ClaudeAsset,
} from '../../contracts/claude-assets.ts';
import { CONVENTION_FOLDERS, type ConventionCount } from '../../contracts/workflow-map.ts';
import { childPath } from '../../contracts/windows-path.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { ProjectPaths } from './git-directory-locator.ts';

/** Which directory under `.claude` holds which kind, and how a file in it is named. */
const ASSET_DIRECTORIES: readonly {
  readonly kind: AssetKind;
  readonly directory: string;
  /** A skill is a directory with this file inside; the other two are the `.md` file itself. */
  readonly inside: string | undefined;
}[] = [
  { kind: 'agent', directory: 'agents', inside: undefined },
  { kind: 'command', directory: 'commands', inside: undefined },
  { kind: 'skill', directory: 'skills', inside: 'SKILL.md' },
];

/**
 * How many entries are listed per directory.
 *
 * The largest measured is 13 skills. A hundred is room for an order of magnitude of growth and a
 * bound on how many head reads one refresh can cost — this is the only part of the map whose work
 * scales with what is in the repository.
 */
const MAX_ENTRIES = 100;

/** Folders under `.claude` that are counted rather than opened (`CONVENTION_FOLDERS`). */
const MAX_CONVENTION_ENTRIES = 2000;

export interface ClaudeAssetParts {
  readonly paths: ProjectPaths;
  readonly files: ProjectFiles;
}

export class ClaudeAssetReader {
  private readonly parts: ClaudeAssetParts;

  constructor(parts: ClaudeAssetParts) {
    this.parts = parts;
  }

  /**
   * Every agent, command and skill under `<claudeDir>`, in that order.
   *
   * The three directories in parallel and the files within each in parallel: they are independent
   * small reads, and a repository with 3 agents, 3 commands and 10 skills would otherwise be 16
   * round trips end to end for one panel.
   *
   * @param claudeDir the project's `.claude`, already resolved.
   */
  public async assets(claudeDir: string): Promise<readonly ClaudeAsset[]> {
    const kinds = await Promise.all(
      ASSET_DIRECTORIES.map(async (entry) => {
        const directory = childPath(claudeDir, entry.directory);
        const names = await this.list(directory, MAX_ENTRIES);
        return Promise.all(
          names.map((name) => this.asset(entry.kind, directory, name, entry.inside)),
        );
      }),
    );
    return kinds.flat().filter((asset): asset is ClaudeAsset => asset !== undefined);
  }

  /**
   * How many files each convention folder holds — SPEC's "file counts", all six, always.
   *
   * A folder that is not there counts `0` rather than being left out, so a repository that keeps
   * none of them says so. That is the cross-project question the row is for: which repos have
   * rules and specs, and which have work in flight.
   */
  public async conventions(claudeDir: string): Promise<readonly ConventionCount[]> {
    return Promise.all(
      CONVENTION_FOLDERS.map(async (folder) => ({
        folder,
        files: (await this.list(childPath(claudeDir, folder), MAX_CONVENTION_ENTRIES)).length,
      })),
    );
  }

  /** One asset, from the head of its file. `undefined` for anything that is not one. */
  private async asset(
    kind: AssetKind,
    directory: string,
    name: string,
    inside: string | undefined,
  ): Promise<ClaudeAsset | undefined> {
    // A skill's entry is its directory and the frontmatter is one level down; an agent's entry is
    // the file. Anything that does not end `.md` in the flat case is a README, a script or a
    // backup, and is not something Claude Code would load either.
    if (inside === undefined && !name.toLowerCase().endsWith('.md')) return undefined;
    const entry = childPath(directory, name);
    const resolved = await this.parts.paths.resolve(
      inside === undefined ? entry : childPath(entry, inside),
    );
    if (!resolved.ok) return undefined;
    const head = await this.parts.files.read(resolved.value, MAX_ASSET_HEAD_BYTES);
    return parseAsset(kind, fallbackName(name), head);
  }

  /** One directory's entries, resolved first. Empty for absent, unreadable and refused alike. */
  private async list(directory: string, maxEntries: number): Promise<readonly string[]> {
    const resolved = await this.parts.paths.resolve(directory);
    if (!resolved.ok) return [];
    return this.parts.files.list(resolved.value, maxEntries);
  }
}

/** `design-check.md` is `/design-check`; a skill's directory is already its name (`ClaudeAsset`). */
function fallbackName(entry: string): string {
  return entry.replace(/\.md$/i, '');
}
