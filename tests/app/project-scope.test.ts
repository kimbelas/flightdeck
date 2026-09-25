// Which project a session is in — P3-T6.
//
// The two rules with teeth are both about paths: a worktree counts as its project (that is what
// SPEC means by a project group), and the DEEPEST imported folder wins when one contains another.
// Both are the kind of thing a bare `startsWith` gets subtly wrong, which is why `isUnder` exists
// and why this file leans on the near-miss cases rather than the obvious ones.
import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../contracts/project.ts';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import type { Worktree } from '../../contracts/worktree.ts';
import { ProjectScope } from '../../app/deck/project-scope.ts';

const REPO = String.raw`C:\dev\xpert-new`;
/**
 * A worktree OUTSIDE the repository, which is the only case the worktree list is load-bearing for.
 *
 * The first version of this file used `…\xpert-new\.claude\worktrees\ticket-41`, which is inside
 * the root and so matched on the root alone: removing the worktree list entirely broke none of the
 * fourteen tests. `git worktree add ../ticket-41` is the ordinary way to make one, and a tree
 * beside its repository is exactly the session this grouping exists to file correctly.
 */
const TREE = String.raw`C:\dev\xpert-trees\ticket-41`;
const INNER = String.raw`C:\dev\xpert-new\packages\web`;
const OTHER = String.raw`C:\dev\pdf-editor`;

function project(path: string): ProjectRecord {
  return { path, name: path.split('\\').at(-1) ?? path, importedAt: 1 };
}

/** Only the field the scope reads. The rest of a map is P3-T3's and is tested there. */
function mapWith(path: string, worktrees: readonly string[]): WorkflowMap {
  const tree = (at: string, index: number): Worktree => ({
    id: index === 0 ? 'main' : (at.split('\\').at(-1) ?? at),
    path: at,
    branch: undefined,
    isMain: index === 0,
  });
  return {
    path,
    at: 0,
    instructions: [],
    assets: [],
    hooks: [],
    servers: [],
    plugins: [],
    marketplaces: [],
    permissions: { allow: [], deny: [], ask: [], defaultMode: undefined },
    conventions: [],
    tickets: [],
    worktrees: worktrees.map(tree),
    gates: undefined,
    configured: true,
  };
}

function row(cwd: string, live = true, startedAt = 1000): SessionRow {
  return {
    sessionId: `${cwd}-id`,
    shortId: 'a1b2c3d4',
    subscription: '365',
    kind: 'background',
    name: undefined,
    cwd,
    startedAt,
    live,
    runState: undefined,
    status: undefined,
    attachable: live,
    notAttachableBecause: undefined,
    endReason: 'unknown',
    retireReason: undefined,
  };
}

describe('ProjectScope.keyFor', () => {
  const scope = new ProjectScope([project(REPO), project(OTHER)], {
    [REPO.toLowerCase()]: mapWith(REPO, [REPO, TREE]),
  });

  it('puts a session in the folder it was started in', () => {
    expect(scope.keyFor(REPO)).toBe(REPO.toLowerCase());
  });

  it('puts a session in a subfolder in the project above it', () => {
    expect(scope.keyFor(String.raw`C:\dev\xpert-new\src\app`)).toBe(REPO.toLowerCase());
  });

  /** SPEC's "project group": a worktree is the same repository and the same work. */
  it('puts a session in a WORKTREE in the project that worktree belongs to', () => {
    expect(scope.keyFor(TREE)).toBe(REPO.toLowerCase());
    expect(scope.keyFor(`${TREE}\\src`)).toBe(REPO.toLowerCase());
  });

  it('matches whatever case and separators the session reported', () => {
    expect(scope.keyFor('c:/DEV/Xpert-New/src')).toBe(REPO.toLowerCase());
  });

  /**
   * The bug `isUnder` exists for, in this file's terms.
   *
   * A bare `startsWith` reads `C:\dev\xpert-new-backup` as being inside `C:\dev\xpert-new`, and a
   * session in an unrelated folder starts being counted against a project.
   */
  it('does not put a sibling whose name merely starts the same in the project', () => {
    expect(scope.keyFor(String.raw`C:\dev\xpert-new-backup\src`)).toBeUndefined();
  });

  it('answers undefined for a folder nobody imported, which is the ordinary case', () => {
    expect(scope.keyFor(String.raw`C:\Windows\Temp`)).toBeUndefined();
  });

  it('gives a nested import the session, because the deeper folder is the more specific answer', () => {
    const nested = new ProjectScope([project(REPO), project(INNER)], {});
    expect(nested.keyFor(`${INNER}\\src`)).toBe(INNER.toLowerCase());
    expect(nested.keyFor(`${REPO}\\src`)).toBe(REPO.toLowerCase());
  });

  it('does not depend on which folder was imported first', () => {
    const reversed = new ProjectScope([project(INNER), project(REPO)], {});
    expect(reversed.keyFor(`${INNER}\\src`)).toBe(INNER.toLowerCase());
  });
});

describe('ProjectScope over a list of sessions', () => {
  const scope = new ProjectScope([project(REPO), project(OTHER)], {
    [REPO.toLowerCase()]: mapWith(REPO, [REPO, TREE]),
  });
  const rows = [
    row(REPO, true, 500),
    row(TREE, false, 900),
    row(OTHER, true, 100),
    row(String.raw`C:\Windows\Temp`, true, 1),
  ];

  it('narrows to one project, worktree included', () => {
    expect(scope.rowsIn(REPO.toLowerCase(), rows).map((one) => one.cwd)).toEqual([REPO, TREE]);
  });

  it('answers every row when nothing is current — a filter, not a hiding place', () => {
    expect(scope.rowsIn(undefined, rows)).toHaveLength(4);
  });

  it('counts sessions, live sessions and the newest start per project', () => {
    expect(scope.activity(rows)).toEqual({
      [REPO.toLowerCase()]: { sessions: 2, live: 1, lastStartedAt: 900 },
      [OTHER.toLowerCase()]: { sessions: 1, live: 1, lastStartedAt: 100 },
    });
  });

  it('leaves a project with no sessions out of the activity map rather than at zero', () => {
    const empty = new ProjectScope([project(REPO)], {});
    expect(empty.activity([])).toEqual({});
  });

  it('counts the sessions in no project at all, which is what All projects has extra', () => {
    expect(scope.unassigned(rows)).toBe(1);
  });

  it('knows whether a remembered key still names an import', () => {
    expect(scope.has(REPO.toLowerCase())).toBe(true);
    expect(scope.has(String.raw`c:\dev\gone`)).toBe(false);
  });
});
