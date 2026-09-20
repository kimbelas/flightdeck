// The wire type for a repository's checkouts — P3-T4.
//
// Two things here are worth a test rather than a reading. The first is that main heads the list
// whatever order the wire sent, because the panel's whole claim is "these are the trees, and this
// is the one the others were linked from". The second is `branchOfHead`, which is the only place
// in this build that reads a git ref file: `HEAD` holds either `ref: refs/heads/<branch>` or a
// bare object id, and a parser that stripped the prefix optimistically would turn the second into
// a branch named after a sha — which is exactly the detached case it must report as having none.
//
// `NEVER_TOUCH_PORTS` is asserted rather than described because it is a safety rule, not a
// preference: a session once read 4201's 200 as its own app being up and killed the process
// holding it (RESEARCH.md §1, SEC-PROC-5).
import { describe, expect, it } from 'vitest';
import {
  branchOfHead,
  isNeverTouchPort,
  MAIN_TREE_ID,
  MAX_BRANCH_CHARS,
  NEVER_TOUCH_PORTS,
  parseWorktree,
  parseWorktrees,
} from '../../contracts/worktree.ts';

const MAIN = 'C:\\Users\\belas\\Documents\\development\\app-next';
const LINKED = 'C:\\Users\\belas\\Documents\\development\\app-next\\.claude\\worktrees\\XWEB-1853';

describe('parseWorktree', () => {
  it('reads a linked tree whole', () => {
    expect(
      parseWorktree({ id: 'XWEB-1853', path: LINKED, branch: 'XWEB-1853', isMain: false }),
    ).toEqual({ id: 'XWEB-1853', path: LINKED, branch: 'XWEB-1853', isMain: false });
  });

  it('reads a detached head as having no branch', () => {
    expect(
      parseWorktree({ id: 'spike', path: LINKED, branch: undefined, isMain: false })?.branch,
    ).toBe(undefined);
  });

  it('treats a branch that is not a usable string as detached rather than as a new state', () => {
    expect(parseWorktree({ id: 'spike', path: LINKED, branch: 17, isMain: false })?.branch).toBe(
      undefined,
    );
    expect(parseWorktree({ id: 'spike', path: LINKED, branch: '', isMain: false })?.branch).toBe(
      undefined,
    );
  });

  it('refuses a row with no id or no path, because neither can be drawn', () => {
    expect(parseWorktree({ id: '', path: LINKED, isMain: false })).toBe(undefined);
    expect(parseWorktree({ id: 'x', path: '', isMain: false })).toBe(undefined);
    expect(parseWorktree(undefined)).toBe(undefined);
  });

  it('refuses a branch longer than a ref can be rather than drawing it', () => {
    const long = 'b'.repeat(MAX_BRANCH_CHARS + 1);
    expect(parseWorktree({ id: 'x', path: LINKED, branch: long, isMain: false })?.branch).toBe(
      undefined,
    );
  });

  it('reads isMain only from a true, never from a truthy', () => {
    expect(parseWorktree({ id: MAIN_TREE_ID, path: MAIN, isMain: 'yes' })?.isMain).toBe(false);
  });
});

describe('parseWorktrees', () => {
  it('puts main first however the wire ordered them', () => {
    const trees = parseWorktrees([
      { id: 'XWEB-1853', path: LINKED, branch: 'XWEB-1853', isMain: false },
      { id: MAIN_TREE_ID, path: MAIN, branch: 'main', isMain: true },
    ]);

    expect(trees.map((tree) => tree.id)).toEqual([MAIN_TREE_ID, 'XWEB-1853']);
  });

  it('keeps the arrival order of the linked trees, which is the directory listing order', () => {
    const at = (name: string): unknown => ({ id: name, path: `${LINKED}-${name}`, isMain: false });
    const trees = parseWorktrees([at('XWEB-1853'), at('XWEB-1854'), at('spike')]);

    expect(trees.map((tree) => tree.id)).toEqual(['XWEB-1853', 'XWEB-1854', 'spike']);
  });

  it('drops one unreadable row rather than the whole list', () => {
    const trees = parseWorktrees([
      { id: '', path: LINKED },
      { id: 'ok', path: LINKED },
    ]);

    expect(trees.map((tree) => tree.id)).toEqual(['ok']);
  });

  it('answers nothing for a body that carried no list', () => {
    expect(parseWorktrees(undefined)).toEqual([]);
    expect(parseWorktrees({ worktrees: [] })).toEqual([]);
  });
});

describe('branchOfHead', () => {
  it('reads the branch out of an attached head', () => {
    expect(branchOfHead('ref: refs/heads/feat/P3-T4-worktrees\n')).toBe('feat/P3-T4-worktrees');
  });

  it('answers nothing for a detached head rather than naming it after its sha', () => {
    expect(branchOfHead('9f1c0f4a4b2e5d6c8a0b1d2e3f4a5b6c7d8e9f01\n')).toBe(undefined);
  });

  it('answers nothing for a HEAD that is not there', () => {
    expect(branchOfHead(undefined)).toBe(undefined);
    expect(branchOfHead('')).toBe(undefined);
  });

  it('reads only the first line, because that is all git writes', () => {
    expect(branchOfHead('ref: refs/heads/main\nsomething else\n')).toBe('main');
  });

  it('refuses a ref longer than a branch name can be', () => {
    expect(branchOfHead(`ref: refs/heads/${'b'.repeat(MAX_BRANCH_CHARS + 1)}`)).toBe(undefined);
  });
});

describe('the ports core may never touch', () => {
  it('holds 4200 and 4201, and says so by number', () => {
    expect(NEVER_TOUCH_PORTS).toEqual([4200, 4201]);
  });

  it('answers for the two and for nothing else', () => {
    expect(isNeverTouchPort(4200)).toBe(true);
    expect(isNeverTouchPort(4201)).toBe(true);
    // Flightdeck's own two, and the neighbours it is allowed to know about.
    expect([4949, 4950, 4747, 4848, 4210].map(isNeverTouchPort)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
