// The ticket ids on disk in one project — P9-T3, SEC-FS-1, SEC-UI-2.
//
// Two directory listings and a `stat` per ticket-shaped name, and nothing is ever opened. The rule
// for what is a ticket is `contracts/project-tickets.ts`; this class is the walk, and the walk goes
// through `resolve` for every path it touches — the two folders and each candidate — which is the
// same door `ClaudeAssetReader` uses, for the same reason (D37, RESEARCH.md G.26).
//
// **Screened before stat, not after.** `.claude/state/` held 63 entries in xpert-new and 16 of them
// are tickets; stating the other 47 would be work spent on names that are thrown away anyway, and
// a name that fails `TICKET_SHAPE` never reaches a path, a log line or the wire (SEC-UI-2).
import {
  newestTickets,
  ticketIdOf,
  TICKET_FOLDERS,
  type FoundTicket,
} from '../../contracts/project-tickets.ts';
import { childPath } from '../../contracts/windows-path.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { ProjectPaths } from './git-directory-locator.ts';

/** `CONVENTION_FOLDERS`' own cap — the two folders are two of those six. */
const MAX_ENTRIES = 2000;

export interface ProjectTicketParts {
  readonly paths: ProjectPaths;
  readonly files: ProjectFiles;
}

export class ProjectTicketReader {
  private readonly parts: ProjectTicketParts;

  constructor(parts: ProjectTicketParts) {
    this.parts = parts;
  }

  /**
   * The ticket ids under `<claudeDir>\specs` and `<claudeDir>\state`, newest first.
   *
   * @param claudeDir the project's `.claude`, already resolved.
   * @returns at most `MAX_TICKETS` ids; `[]` when neither folder is there. @throws never.
   */
  public async tickets(claudeDir: string): Promise<readonly string[]> {
    const found = await Promise.all(
      TICKET_FOLDERS.map(async ({ folder, isDirectory }) => {
        const directory = childPath(claudeDir, folder);
        const names = await this.list(directory);
        const candidates = names.flatMap((name) => {
          const id = ticketIdOf(folder, name);
          return id === undefined ? [] : [{ id, path: childPath(directory, name) }];
        });
        return Promise.all(candidates.map(({ id, path }) => this.found(id, path, isDirectory)));
      }),
    );
    return newestTickets(found.flat().filter((ticket) => ticket !== undefined));
  }

  /** One candidate, if it is the kind of entry its folder names a ticket with. */
  private async found(
    id: string,
    path: string,
    isDirectory: boolean,
  ): Promise<FoundTicket | undefined> {
    const resolved = await this.parts.paths.resolve(path);
    if (!resolved.ok) return undefined;
    const facts = await this.parts.files.facts(resolved.value);
    if (facts?.isDirectory !== isDirectory) return undefined;
    return { id, modifiedAt: facts.modifiedAt };
  }

  /** One folder's entry names. Empty for absent, unreadable and refused alike. */
  private async list(directory: string): Promise<readonly string[]> {
    const resolved = await this.parts.paths.resolve(directory);
    if (!resolved.ok) return [];
    return this.parts.files.list(resolved.value, MAX_ENTRIES);
  }
}
