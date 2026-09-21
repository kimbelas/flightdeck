// What the handoff control offers, and what it says when it offers nothing — P6-T6.
//
// A leaf's test (G.53): `handoff-view-model.ts` reaches `contracts/` and nothing else under
// `app/`, so importing it here does not drag the DOM project's files into the one without a DOM.
//
// The question underneath every case: can this control ever point somewhere a handoff should not
// go? A target that is the folder the session is already in is the one that matters, because core
// would happily accept it — `resolveDirectory` screens for "may core write here", not for "is this
// a different tree" — and the result would be two sessions competing over one working tree, which
// is the thing P6-T5 warns about one task earlier.
import { describe, expect, it } from 'vitest';
import {
  MAX_HANDOFF_NAME_CHARS,
  handoffOffer,
  handoffRefusalLine,
} from '../../app/deck/handoff-view-model.ts';
import { HANDOFF_FAILURES } from '../../contracts/launch-reply.ts';
import type { Worktree } from '../../contracts/worktree.ts';

const ROOT = String.raw`C:\Users\owner\Documents\ledger`;

function tree(id: string, path: string, branch?: string, isMain = false): Worktree {
  return { id, path, branch, isMain };
}

const MAIN = tree('main', ROOT, 'main', true);
const TICKET = tree('XWEB-1853', String.raw`C:\Users\owner\Documents\XWEB-1853`, 'XWEB-1853');
const PICKER = tree(
  'XWEB-1854',
  String.raw`C:\Users\owner\Documents\XWEB-1854`,
  'feat/rework-the-picker',
);

describe('handoffOffer — the targets', () => {
  it('offers every tree but the one the session is already in', () => {
    const offer = handoffOffer([MAIN, TICKET, PICKER], ROOT, 'fd-alpha');

    expect(offer.targets.map((target) => target.id)).toEqual(['XWEB-1853', 'XWEB-1854']);
    expect(offer.nothingBecause).toBeUndefined();
  });

  // The whole point of the exclusion. `\Documents\ledger\` and `C:\USERS\...\LEDGER` are the same
  // folder to Windows and to core, and a filter that compared the strings would offer the session
  // its own tree back — a fork competing with the original over one checkout.
  it.each([
    { cwd: `${ROOT}\\`, why: 'a trailing separator' },
    { cwd: ROOT.toUpperCase(), why: 'a different case' },
    { cwd: ROOT.replaceAll('\\', '/'), why: 'forward slashes' },
  ])('excludes the session’s own tree despite $why', ({ cwd }) => {
    const offer = handoffOffer([MAIN, TICKET], cwd, 'fd-alpha');

    expect(offer.targets.map((target) => target.id)).toEqual(['XWEB-1853']);
  });

  // A session in a worktree is the ordinary case for this control, not the exotic one: it is what
  // "hand it back to main" means, and main must be on the list when somebody is standing elsewhere.
  it('offers main when the session is in a worktree', () => {
    const offer = handoffOffer([MAIN, TICKET, PICKER], TICKET.path, 'fd-alpha');

    expect(offer.targets.map((target) => target.id)).toEqual(['main', 'XWEB-1854']);
  });

  it('labels a tree with the branch, which is what somebody is choosing between', () => {
    const offer = handoffOffer([MAIN, PICKER], ROOT, 'fd-alpha');

    expect(offer.targets[0]?.label).toBe('XWEB-1854 · feat/rework-the-picker');
  });

  // A worktree is usually made for a ticket and checked out on a branch named after the same
  // ticket, so this is the common case rather than the tidy one. The projects panel already draws
  // it this way (`WorkflowMapViewModel`), and two vocabularies for one tree is one too many.
  it('does not repeat a branch that is the tree’s own name', () => {
    const offer = handoffOffer([MAIN, TICKET], ROOT, 'fd-alpha');

    expect(offer.targets[0]?.label).toBe('XWEB-1853');
  });

  // A detached HEAD has no name. Seven hex characters where every other row has a branch would
  // invite somebody to read them as one (`contracts/worktree.ts`).
  it('labels a detached head with the name alone', () => {
    const offer = handoffOffer([tree('spike', String.raw`C:\spike`)], ROOT, 'fd-alpha');

    expect(offer.targets[0]?.label).toBe('spike');
  });

  it('carries the path core will be sent, not the label somebody read', () => {
    const offer = handoffOffer([MAIN, TICKET], ROOT, 'fd-alpha');

    expect(offer.targets[0]?.path).toBe(TICKET.path);
  });
});

describe('handoffOffer — the three silences', () => {
  // Most sessions on this machine are in folders nobody has imported (`ProjectScope`), so this is
  // the ordinary answer. Telling somebody to make a worktree here would be the wrong instruction:
  // the fix is an import.
  it('says the project is unknown when the session is in none', () => {
    const offer = handoffOffer(undefined, ROOT, 'fd-alpha');

    expect(offer.targets).toEqual([]);
    expect(offer.nothingBecause).toContain('not in an imported project');
  });

  it('says the reading has not arrived when the project has no map yet', () => {
    const offer = handoffOffer([], ROOT, 'fd-alpha');

    expect(offer.nothingBecause).toContain('No worktrees read');
  });

  it('says there is nowhere to go when the only tree is the one it is in', () => {
    const offer = handoffOffer([MAIN], ROOT, 'fd-alpha');

    expect(offer.nothingBecause).toContain('only worktree');
  });

  // Three different silences, three different sentences. A shared one would tell somebody to go
  // and make a worktree they already have, or to import a folder they imported an hour ago.
  it('says three different things', () => {
    const said = [
      handoffOffer(undefined, ROOT, 'a').nothingBecause,
      handoffOffer([], ROOT, 'a').nothingBecause,
      handoffOffer([MAIN], ROOT, 'a').nothingBecause,
    ];

    expect(new Set(said).size).toBe(3);
  });
});

describe('handoffOffer — the suggested name', () => {
  // `-n` will give two live sessions the same name (G.54), and the deck would then show two
  // identical rows. Pressing straight through must not be able to produce that.
  it('suffixes rather than reuses the name', () => {
    expect(handoffOffer([MAIN, TICKET], ROOT, 'fd-alpha').suggestedName).toBe('fd-alpha-fork');
  });

  it('falls back to a name rather than suggesting an empty one', () => {
    expect(handoffOffer([MAIN, TICKET], ROOT, '   ').suggestedName).toBe('handoff-fork');
  });

  // The field caps at the same number, so a suggestion longer than the cap would be one the box
  // silently truncated — and a name core refuses is a round trip to learn what a slice knew.
  it('never suggests a name core would refuse for its length', () => {
    const long = 'x'.repeat(200);

    const suggested = handoffOffer([MAIN, TICKET], ROOT, long).suggestedName;

    expect(suggested.length).toBe(MAX_HANDOFF_NAME_CHARS);
  });
});

describe('handoffRefusalLine', () => {
  it('has a sentence for every code core can send', () => {
    for (const failure of HANDOFF_FAILURES) {
      expect(handoffRefusalLine(failure).length).toBeGreaterThan(0);
    }
  });

  it('says something different for each of them', () => {
    const said = HANDOFF_FAILURES.map((failure) => handoffRefusalLine(failure));

    expect(new Set(said).size).toBe(HANDOFF_FAILURES.length);
  });

  // The question a refusal raises. This is the one verb in the deck that ADDS a session, and
  // somebody just told "no" needs to know they have not also lost the one they pressed on.
  it('never suggests the original session was harmed', () => {
    for (const failure of HANDOFF_FAILURES) {
      expect(handoffRefusalLine(failure)).not.toMatch(/lost|deleted|gone forever/iu);
    }
  });
});
