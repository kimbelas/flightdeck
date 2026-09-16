// SPEC §5.1's first row — which files tell Claude what to do here, and how big they are (P3-T3).
//
// **Five stats and nothing opened.** What the row shows is the resolution order and the byte size
// of each file, and `stat` answers both. That is not only cheap: the largest file in the stack is
// the one it would be most expensive to read, and a panel that read every `CLAUDE.md` on every
// refresh would be spending the most on the least interesting reading in the map.
//
// **Every path goes through `resolve`, including the two that are not in a project.** The user
// files live under a config directory, where the rules are ALLOW-list rather than deny-list, and
// `CLAUDE.md` is on that list by a decision made in this task (DECISIONS.md D38, read-policy.ts).
// Screening them the same way as the project's own files is what keeps the count of doors at one —
// the alternative, a reader that stats a config-directory path directly because "it is only a
// stat", is how the second door gets built.
//
// **A refusal and an absence are the same answer.** A `soul.md` that is not there, one on an
// unplugged drive, and one core may not open all report `bytes: undefined`, because all three mean
// the same thing to somebody reading a stack: that file is not speaking here. Distinguishing them
// would put SEC-FS-1 on screen next to a byte count.
//
// **The source-to-path mapping is a switch, not a zip.** Two of the five come from a config
// directory and three from the project root, so a positional pairing of two lists would be correct
// only while both stayed in the order somebody remembered — and the failure would be a `soul.md`
// drawn as the user's instructions. An exhaustive switch over the union means adding a source to
// `INSTRUCTION_SOURCES` stops this file compiling until it has a path (R12).
import {
  INSTRUCTION_SOURCES,
  type InstructionFile,
  type InstructionSource,
} from '../../contracts/instruction-stack.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import { childPath } from '../../contracts/windows-path.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { ProjectPaths } from './git-directory-locator.ts';

/** The user-scope instruction file's name in a config directory — the one entry D38 allowlisted. */
const USER_INSTRUCTIONS = 'CLAUDE.md';

export interface InstructionStackParts {
  readonly paths: ProjectPaths;
  readonly files: ProjectFiles;
  /**
   * Both config directories, keyed by subscription — `SubscriptionPaths`' shape, and for its
   * reason: a pair of strings in a list is a pair somebody has to keep in the right order, and a
   * record says which is which.
   */
  readonly configDirs: Readonly<Record<SubscriptionId, string>>;
}

export class InstructionStackReader {
  private readonly parts: InstructionStackParts;

  constructor(parts: InstructionStackParts) {
    this.parts = parts;
  }

  /**
   * The stack for one project root, in `INSTRUCTION_SOURCES` order, present or not.
   *
   * In parallel: five independent stats, and serialising them would make the cheapest reading in
   * the map take five round trips to the filesystem.
   *
   * @param root a canonical project root, already through `resolveRoot`.
   */
  public async read(root: string): Promise<readonly InstructionFile[]> {
    return Promise.all(
      INSTRUCTION_SOURCES.map(async (source) => {
        const bytes = await this.bytes(this.pathFor(source, root));
        return bytes === undefined ? { source, bytes: undefined } : { source, bytes };
      }),
    );
  }

  /** One file's size, or `undefined` for absent, unreadable and refused alike. See the header. */
  private async bytes(path: string): Promise<number | undefined> {
    const resolved = await this.parts.paths.resolve(path);
    if (!resolved.ok) return undefined;
    const facts = await this.parts.files.facts(resolved.value);
    // A directory named `CLAUDE.md` is not an instruction file, and reporting its size as one
    // would be the panel making something up about a folder.
    if (facts === undefined || facts.isDirectory) return undefined;
    return facts.sizeBytes;
  }

  /** Where each source lives. Exhaustive over the union by construction — see the header. */
  private pathFor(source: InstructionSource, root: string): string {
    switch (source) {
      case 'user-365':
        return childPath(this.parts.configDirs['365'], USER_INSTRUCTIONS);
      case 'user-isg':
        return childPath(this.parts.configDirs.isg, USER_INSTRUCTIONS);
      case 'claude-md':
        return childPath(root, 'CLAUDE.md');
      case 'agents-md':
        return childPath(root, 'AGENTS.md');
      case 'soul-md':
        return childPath(childPath(root, '.claude'), 'soul.md');
    }
  }
}
