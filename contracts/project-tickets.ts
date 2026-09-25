// The tickets a project can plan against — P9-T3, SEC-FS-1, SEC-UI-2.
//
// The plan-first prompt (`TicketPrompt`) sends Claude to `.claude/specs/<TICKET>/` or
// `.claude/state/<TICKET>.md`, so the ids a project can plan against are already on disk, as
// NAMES, in two of the folders `CONVENTION_FOLDERS` counts. Core lists the two folders, keeps the
// names that are ticket-shaped and nothing else, and the deck offers them under the `ticket`
// preset's name box. The rule for what counts is here, in `contracts/`, because both ends apply it:
// core before a name leaves the machine's filesystem, the deck again on what the wire carried.
//
// **Names only, never contents.** The map reads a 4 KB head of an asset; this reads less — a
// directory listing and one `stat` per candidate, for the mtime the list is ordered by.
//
// **Top-level entries only.** `specs/completed/` and `state/archive/` hold finished work (73 old
// tickets under `completed/` in xpert-new, measured 2026-09-25). They are not descended into: the
// picker is for work that could start now, and a finished ticket is still typeable by hand.
import { TICKET_SHAPE } from './ticket-prompt.ts';

/** How many ids the map carries — the newest, so a long-lived repository's picker stays short. */
export const MAX_TICKETS = 200;

/**
 * The two folders a ticket id can come from, and the shape an entry takes in each.
 *
 * A spec is a DIRECTORY named for the ticket; a state note is a `.md` FILE named for it. The kind
 * is checked as well as the name, so `specs/XWEB-1.md` or a `state/XWEB-2/` folder — neither of
 * which the prompt points at — is not offered.
 */
export const TICKET_FOLDERS = [
  { folder: 'specs', isDirectory: true },
  { folder: 'state', isDirectory: false },
] as const;

export type TicketFolder = (typeof TICKET_FOLDERS)[number]['folder'];

/** One ticket found on disk, before the list is ordered. */
export interface FoundTicket {
  readonly id: string;
  /** Whole seconds, from `FileFacts.modifiedAt`. */
  readonly modifiedAt: number;
}

/**
 * The ticket id an entry names, or `undefined` for anything else.
 *
 * `XWEB-1830.md` in `state/` is `XWEB-1830`; `XWEB-1881-findings.md`, `XWEB-1871-r2.patch`,
 * `RESUME-PROMPT.md` and `archive` are not ids and come back `undefined`. Upper-cased, which is
 * what `TicketPrompt` does to a typed id, so an id in both folders is one id whatever its casing.
 */
export function ticketIdOf(folder: TicketFolder, entry: string): string | undefined {
  const stem = folder === 'state' ? markdownStem(entry) : entry;
  if (stem === undefined || !TICKET_SHAPE.test(stem)) return undefined;
  return stem.toUpperCase();
}

/**
 * Newest first, each id once, at most `MAX_TICKETS`.
 *
 * An id in both folders keeps the later of its two mtimes: the spec may be old and the state note
 * written this morning, and this morning is when the work was last touched. Ties fall back to the
 * id, so the order is the same on every read.
 */
export function newestTickets(found: readonly FoundTicket[]): readonly string[] {
  const newest = new Map<string, number>();
  for (const ticket of found) {
    newest.set(ticket.id, Math.max(ticket.modifiedAt, newest.get(ticket.id) ?? ticket.modifiedAt));
  }
  return [...newest.entries()]
    .sort(([a, at], [b, bt]) => bt - at || a.localeCompare(b))
    .slice(0, MAX_TICKETS)
    .map(([id]) => id);
}

/**
 * The ids a `GET /projects/map` body carried, screened again.
 *
 * Again rather than trusted, because the deck puts these into a `<datalist>` and the shape is what
 * makes that safe by construction (SEC-UI-2): whatever is not ticket-shaped is dropped, not drawn.
 *
 * @throws never.
 */
export function parseTicketList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const tickets = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && TICKET_SHAPE.test(entry)) tickets.add(entry.toUpperCase());
    if (tickets.size === MAX_TICKETS) break;
  }
  return [...tickets];
}

/** `XWEB-1830.md` → `XWEB-1830`; anything that is not a `.md` file name → `undefined`. */
function markdownStem(entry: string): string | undefined {
  return entry.toLowerCase().endsWith('.md') ? entry.slice(0, -'.md'.length) : undefined;
}
