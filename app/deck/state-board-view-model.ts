// The State board's columns, decided outside React — P10-T1, CODING-STANDARDS §3.
//
// Every column is a question the deck could already answer. Four of them are
// `SessionRowViewModel.tone`, which is D29's one signal for "needs you" and already ranks `ended`
// before `blocked` (G.24), so a session that died while waiting is in Ended and never in Needs you.
// The fifth, Shells, is the open shell panes: a shell exists only as a pane (`shell-pane.ts`), so a
// shell card is always "in pane N". There is no card for a shell that is not open, because no such
// shell exists.
//
// **Nothing here invents a field.** The mockup's cost, last-tool line and Snooze have no data
// behind them, and the owner dropped them rather than having them faked (P10-T1's notes).
import type { OpenPane } from './open-pane.ts';
import type { RowTone, SessionRowViewModel } from './session-row-view-model.ts';

export type BoardColumnId = RowTone | 'shells';

/** One shell pane, as its card shows it. */
export interface ShellCardModel {
  readonly key: string;
  readonly title: string;
  /** 1-based, the number its digit key focuses — `focusPane`. */
  readonly pane: number;
}

export interface BoardColumn {
  readonly id: BoardColumnId;
  readonly label: string;
  /** Idle and Ended are drawn quieter: nothing in them is asking for anything. */
  readonly muted: boolean;
  /** Everything in the column, including what "Show N more" is holding back. */
  readonly count: number;
  readonly rows: readonly SessionRowViewModel[];
  readonly shells: readonly ShellCardModel[];
  /** How many cards the column is not drawing yet. Zero once revealed, and on uncapped columns. */
  readonly hidden: number;
}

/**
 * How many cards a quiet column draws before "Show N more".
 *
 * Only the quiet ones. A cap on Needs you would hide the one card the board exists to show, and
 * Working is bounded by what is actually running.
 */
export const QUIET_COLUMN_CAP = 5;

const LABELS: Readonly<Record<BoardColumnId, string>> = {
  'needs-you': 'Needs you',
  working: 'Working',
  shells: 'Shells',
  idle: 'Idle',
  ended: 'Ended',
};

/** In the mockup's order, which is also how urgent each column is, left to right. */
const ORDER: readonly BoardColumnId[] = ['needs-you', 'working', 'shells', 'idle', 'ended'];

const QUIET: ReadonlySet<BoardColumnId> = new Set(['idle', 'ended']);

export class StateBoardViewModel {
  private readonly rows: readonly SessionRowViewModel[];
  private readonly panes: readonly OpenPane[];
  private readonly revealed: ReadonlySet<BoardColumnId>;

  /**
   * @param rows in the deck's order (`byAttentionThenAge`), which each column keeps.
   * @param panes the open panes, in grid order — what "in pane N" counts along.
   * @param revealed the columns whose "Show N more" has been pressed.
   */
  constructor(
    rows: readonly SessionRowViewModel[],
    panes: readonly OpenPane[],
    revealed: ReadonlySet<BoardColumnId> = new Set(),
  ) {
    this.rows = rows;
    this.panes = panes;
    this.revealed = revealed;
  }

  public get columns(): readonly BoardColumn[] {
    return ORDER.map((id) => (id === 'shells' ? this.shellColumn() : this.sessionColumn(id)));
  }

  /**
   * Which pane a session is in, 1-based, or `undefined` when it is in none.
   *
   * The number `1`–`9` would focus, so "in pane 2" and the key that reaches it cannot disagree.
   */
  public paneNumber(key: string): number | undefined {
    const index = this.panes.findIndex((pane) => pane.key === key);
    return index === -1 ? undefined : index + 1;
  }

  private sessionColumn(id: RowTone): BoardColumn {
    const all = this.rows.filter((row) => row.tone === id);
    const capped = QUIET.has(id) && !this.revealed.has(id);
    const rows = capped ? all.slice(0, QUIET_COLUMN_CAP) : all;
    return {
      id,
      label: LABELS[id],
      muted: QUIET.has(id),
      count: all.length,
      rows,
      shells: [],
      hidden: all.length - rows.length,
    };
  }

  private shellColumn(): BoardColumn {
    const shells = this.panes.flatMap((pane, index) =>
      pane.target.kind === 'shell' ? [{ key: pane.key, title: pane.title, pane: index + 1 }] : [],
    );
    return {
      id: 'shells',
      label: LABELS.shells,
      muted: false,
      count: shells.length,
      rows: [],
      shells,
      hidden: 0,
    };
  }
}
