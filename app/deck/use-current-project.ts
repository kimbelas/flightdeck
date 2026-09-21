// Which project the deck is pointed at — P3-T6, SPEC §5.6.
//
// Two things have been waiting on this since before it existed, and both are named in the roadmap:
// the palette's "switch project" (`deck-commands.ts`, since P2-T5) and the pane layout, which
// SPEC §5.3 says is saved per project and which `usePaneGrid` has saved per browser since P5a-T5
// with a comment saying it would move here. Neither needed a current project to be STORED anywhere
// clever — they needed one to exist at all.
//
// **It is a fact about this browser, not about the machine**, so it lives beside the layout in
// `localStorage` rather than in core or in `DeckState`. Two windows open on two projects is a
// reasonable thing to want, and a current project in the store would make the second window follow
// the first. That is the same call `usePaneGrid` made about the grid.
//
// **`undefined` means all projects, and it is the state the deck starts in.** A deck that picked a
// project on the owner's behalf would be hiding sessions the moment it opened.
import { useCallback, useEffect, useState } from 'react';
import { projectKey } from '../../contracts/project.ts';

/** Where the current project survives a reload. Its value is a `projectKey`. */
const PROJECT_KEY = 'flightdeck.project';

export interface CurrentProject {
  /** A `projectKey`, or `undefined` for all projects. */
  readonly key: string | undefined;
  readonly choose: (key: string | undefined) => void;
}

/**
 * The current project, remembered.
 *
 * @param known whether a key still names an imported folder.
 *
 * **The stored key is kept and the CURRENT one is derived from it**, rather than the store being
 * corrected in place. Both cases that matters for were measured by running it: the registry is
 * fetched after the page mounts, so a guard that cleared an "unknown" key on mount erased the
 * choice every reload before the answer had arrived — and a project that is forgotten and then
 * re-imported comes back current, because nothing threw the choice away in between. What a
 * registry without it draws is all projects, which is the same thing a person would expect.
 */
export function useCurrentProject(known: (key: string) => boolean): CurrentProject {
  const [stored, setStored] = useState<string | undefined>(undefined);

  // Read after mount rather than in an initialiser: `localStorage` does not exist while Next is
  // rendering this on the server, and reading it during render makes the first client render
  // disagree with the server's (`usePaneGrid`'s rule, and the reason it is written down twice).
  useEffect(() => {
    setStored(read());
  }, []);

  const choose = useCallback((next: string | undefined) => {
    setStored(next);
    write(next);
  }, []);

  return { key: stored !== undefined && known(stored) ? stored : undefined, choose };
}

/** The layout's storage key for one project — P5a-T5's `flightdeck.pane-layout`, now per project. */
export function layoutKeyFor(project: string | undefined): string {
  return project === undefined ? 'flightdeck.pane-layout' : `flightdeck.pane-layout:${project}`;
}

/**
 * The stored project, canonicalised on the way out.
 *
 * Through `projectKey` rather than trusted: this is a value a person can hand-edit, and every
 * comparison downstream is against a canonical key. A stored `C:/Dev/Repo` would otherwise match
 * nothing and read as a project that had disappeared.
 */
function read(): string | undefined {
  try {
    const raw = window.localStorage.getItem(PROJECT_KEY);
    return raw === null || raw === '' ? undefined : projectKey(raw);
  } catch {
    return undefined;
  }
}

function write(key: string | undefined): void {
  try {
    if (key === undefined) window.localStorage.removeItem(PROJECT_KEY);
    else window.localStorage.setItem(PROJECT_KEY, key);
  } catch {
    // A choice that cannot be remembered is still a choice that works for this session.
  }
}
