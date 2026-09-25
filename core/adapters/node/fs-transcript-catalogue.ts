// Walking `$CFG\projects\<slug>\*.jsonl` — P7-T1, SEC-FS-1.
//
// **The directories come from the install, not from a caller.** `ClaudeInstall.configDirFor` picks
// them from the closed `SubscriptionId` union, so there is no path here that anything outside core
// chose — the rule `watchTargets` follows, for the reason SEC-FS-1 exists.
//
// **Nothing throws.** A machine with one subscription has no `.claude-isg\projects` at all, a slug
// folder can be deleted between the listing and the `stat`, and a transcript is removed after
// thirty days. Every one of those is an ordinary state, and an indexer that stopped because a file
// went away between two syscalls would stop for good.
//
// **A filename that is not a uuid is not indexed.** Claude Code names a transcript after the
// session, and that equality is what makes a search hit something the deck can open. A file called
// anything else in that folder is something else's, and inventing a session id for it would put a
// row in the index that points nowhere.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../../contracts/session.ts';
import type { ClaudeInstall } from '../claude-cli/claude-install.ts';
import type { CatalogueEntry, TranscriptCatalogue } from '../../ports/transcript-catalogue.ts';

/** A transcript's filename is the session uuid. Lowercase, because that is how they are written. */
const TRANSCRIPT_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/u;

/** Where Claude Code keeps them, under each config directory. */
const PROJECTS_DIR = 'projects';

export class FsTranscriptCatalogue implements TranscriptCatalogue {
  private readonly install: ClaudeInstall;

  constructor(install: ClaudeInstall) {
    this.install = install;
  }

  public async list(): Promise<readonly CatalogueEntry[]> {
    const found: (CatalogueEntry & { readonly mtime: number })[] = [];
    for (const subscription of SUBSCRIPTION_IDS) {
      found.push(...(await this.listOne(subscription)));
    }
    // Newest-written first — see the port for why the order is part of the contract. The mtime is
    // dropped rather than carried: it is how this ordered, not something a caller may act on.
    return found
      .sort((left, right) => right.mtime - left.mtime)
      .map((entry) => ({
        path: entry.path,
        subscription: entry.subscription,
        sessionId: entry.sessionId,
        projectKey: entry.projectKey,
        bytes: entry.bytes,
      }));
  }

  private async listOne(
    subscription: SubscriptionId,
  ): Promise<readonly (CatalogueEntry & { readonly mtime: number })[]> {
    const root = join(this.install.configDirFor(subscription), PROJECTS_DIR);
    const found: (CatalogueEntry & { readonly mtime: number })[] = [];
    for (const slug of await slugsIn(root)) {
      found.push(...(await filesIn(join(root, slug), slug, subscription)));
    }
    return found;
  }
}

/** The slug folders under one `projects` directory, or none when it is not there. */
async function slugsIn(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** One directory's entries, or none. A slug folder can go away between the two listings. */
async function namesIn(dir: string): Promise<readonly string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** The transcripts in one slug folder, with the size and mtime the walk already paid for. */
async function filesIn(
  dir: string,
  projectKey: string,
  subscription: SubscriptionId,
): Promise<readonly (CatalogueEntry & { readonly mtime: number })[]> {
  const names = await namesIn(dir);
  const found: (CatalogueEntry & { readonly mtime: number })[] = [];
  for (const name of names) {
    const sessionId = TRANSCRIPT_NAME.exec(name)?.[1];
    if (sessionId === undefined) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      found.push({
        path,
        subscription,
        sessionId,
        projectKey,
        bytes: info.size,
        mtime: info.mtimeMs,
      });
    } catch {
      // Deleted between the listing and the stat. Thirty-day cleanup does this; it is not an error.
      continue;
    }
  }
  return found;
}
