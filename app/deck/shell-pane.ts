// Naming the next shell pane — P6-T1, SPEC §5.7(3).
//
// A shell carried no identity until this task, which is why only one could ever be open: the grid
// keyed every shell as `shell`, so a second one replaced the first. SPEC wants a pane per
// repository — `git` in one, `npm run dev` in another — so a shell is now something you can have
// several of, and something that has to be named.
//
// **The id is chosen from what is on screen, not counted up forever.** Closing `shell-1` and
// opening another gives `shell-1` again rather than `shell-7`, because the id is in the pane's
// title bar via its key and a number that only grows is a number that starts looking like a leak.
// Two panes never share one: the search is over the panes that exist.
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import type { OpenPane } from './open-pane.ts';

/** How many shells the search will consider before giving up. The grid draws at most nine. */
const MAX_SHELLS = 32;

/**
 * The pane a press of `+ shell` opens.
 *
 * @param open the panes already on screen, so the id is free.
 * @param project a `projectKey`, or `undefined` for home. It is the CURRENT project: a shell you
 * opened while looking at one repository should be in that repository, which is the whole of
 * SPEC's "or the goal fails at the first `git status`".
 * @param label what the folder is called, for the pane's title. `home` when there is no project.
 */
export function nextShellPane(
  open: readonly OpenPane[],
  project: string | undefined,
  label: string,
): OpenPane {
  const id = freeShellId(open);
  const target: PtyTarget = { kind: 'shell', id, project };
  return { key: `pane-${id}`, title: `${id} · ${label}`, target };
}

/**
 * The lowest `shell-<n>` no open pane is using.
 *
 * Falls back to the number past the cap rather than reusing one: an id that collided would make
 * the grid draw two cards with one key, which React resolves by drawing one of them.
 */
function freeShellId(open: readonly OpenPane[]): string {
  const taken = new Set(
    open.flatMap((pane) => (pane.target.kind === 'shell' ? [pane.target.id] : [])),
  );
  for (let index = 1; index <= MAX_SHELLS; index += 1) {
    const candidate = `shell-${String(index)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `shell-${String(MAX_SHELLS + 1)}`;
}
