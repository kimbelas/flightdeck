// Which shell the next one is — P6-T1.
import { describe, expect, it } from 'vitest';
import type { OpenPane } from '../../app/deck/open-pane.ts';
import { nextShellPane } from '../../app/deck/shell-pane.ts';

const KEY = String.raw`c:\users\owner\documents\ledger`;

/** A pane already on screen, as the grid would hold it. */
function shell(id: string, project?: string): OpenPane {
  return { key: `pane-${id}`, title: id, target: { kind: 'shell', id, project } };
}

describe('nextShellPane', () => {
  it('names the first one `shell-1`', () => {
    expect(nextShellPane([], undefined, 'home').target).toEqual({
      kind: 'shell',
      id: 'shell-1',
      project: undefined,
    });
  });

  it('carries the current project, which is what makes `git status` work there', () => {
    expect(nextShellPane([], KEY, 'ledger').target).toEqual({
      kind: 'shell',
      id: 'shell-1',
      project: KEY,
    });
  });

  it('puts the folder in the title, so two shells are told apart on screen', () => {
    expect(nextShellPane([], KEY, 'ledger').title).toBe('shell-1 · ledger');
  });

  it('gives the pane a key of its own — one shell per pane, not one shell ever', () => {
    const first = nextShellPane([], undefined, 'home');
    const second = nextShellPane([first], undefined, 'home');

    expect([first.key, second.key]).toEqual(['pane-shell-1', 'pane-shell-2']);
  });

  it('skips the ids already on screen', () => {
    const open = [shell('shell-1'), shell('shell-2')];

    expect(nextShellPane(open, undefined, 'home').target).toMatchObject({ id: 'shell-3' });
  });

  // A number that only grows starts looking like a leak, and the id is in the pane's title.
  it('reuses the lowest free id rather than counting up forever', () => {
    const open = [shell('shell-1'), shell('shell-3')];

    expect(nextShellPane(open, undefined, 'home').target).toMatchObject({ id: 'shell-2' });
  });

  it('ignores session panes when it looks for a free id', () => {
    const session: OpenPane = {
      key: 'x',
      title: 'x',
      target: {
        kind: 'session',
        sessionId: '11111111-2222-3333-4444-555555555555',
        subscription: '365',
      },
    };

    expect(nextShellPane([session], undefined, 'home').target).toMatchObject({ id: 'shell-1' });
  });

  it('counts a shell in another folder as taking its id, because the KEY is shared', () => {
    // Two panes cannot share a React key even if their targets differ, and the pane key is
    // derived from the shell id alone.
    const open = [shell('shell-1', KEY)];

    expect(nextShellPane(open, undefined, 'home').target).toMatchObject({ id: 'shell-2' });
  });
});
