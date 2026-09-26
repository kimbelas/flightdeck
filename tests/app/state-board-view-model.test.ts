// The State board's columns, tested without React — P10-T1, CODING-STANDARDS §10.4.
import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../contracts/session-row.ts';
import type { OpenPane } from '../../app/deck/open-pane.ts';
import { SessionRowViewModel } from '../../app/deck/session-row-view-model.ts';
import {
  QUIET_COLUMN_CAP,
  StateBoardViewModel,
  type BoardColumn,
  type BoardColumnId,
} from '../../app/deck/state-board-view-model.ts';

const BASE: SessionRow = {
  sessionId: '337975f9-c9c0-454a-a22a-2d53a86e0ea9',
  shortId: '337975f9',
  subscription: '365',
  kind: 'background',
  name: 'fd-board',
  cwd: 'C:\\Users\\dev\\Documents\\development\\flightdeck',
  startedAt: 1_000_000,
  live: true,
  runState: 'working',
  status: 'busy',
  attachable: true,
  notAttachableBecause: undefined,
  endReason: 'unknown',
  retireReason: undefined,
};

function row(name: string, overrides: Partial<SessionRow> = {}): SessionRowViewModel {
  return new SessionRowViewModel({ ...BASE, sessionId: name, name, ...overrides });
}

const BLOCKED = { runState: 'blocked' } as const;
const IDLE = { runState: undefined, status: 'idle' } as const;
const ENDED = { live: false, runState: 'done', attachable: false } as const;

function sessionPane(key: string): OpenPane {
  return { key, title: key, target: { kind: 'session', sessionId: key, subscription: '365' } };
}

function shellPane(id: string): OpenPane {
  return {
    key: `pane-${id}`,
    title: `${id} · home`,
    target: { kind: 'shell', id, project: undefined },
  };
}

function column(board: StateBoardViewModel, id: BoardColumnId): BoardColumn {
  const found = board.columns.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no ${id} column`);
  return found;
}

function names(board: StateBoardViewModel, id: BoardColumnId): readonly string[] {
  return column(board, id).rows.map((each) => each.title);
}

describe('StateBoardViewModel — the columns', () => {
  it('is the mockup’s five, in its order', () => {
    const board = new StateBoardViewModel([], []);

    expect(board.columns.map((each) => each.label)).toEqual([
      'Needs you',
      'Working',
      'Shells',
      'Idle',
      'Ended',
    ]);
  });

  it('puts each session in the column its tone names', () => {
    const board = new StateBoardViewModel(
      [row('asks', BLOCKED), row('runs'), row('rests', IDLE), row('gone', ENDED)],
      [],
    );

    expect(names(board, 'needs-you')).toEqual(['asks']);
    expect(names(board, 'working')).toEqual(['runs']);
    expect(names(board, 'idle')).toEqual(['rests']);
    expect(names(board, 'ended')).toEqual(['gone']);
  });

  it('keeps a session that ended while blocked out of Needs you (G.24)', () => {
    const board = new StateBoardViewModel([row('dead', { ...ENDED, runState: 'blocked' })], []);

    expect(names(board, 'needs-you')).toEqual([]);
    expect(names(board, 'ended')).toEqual(['dead']);
  });

  it('keeps the order the rows arrived in inside a column', () => {
    const board = new StateBoardViewModel([row('b'), row('a'), row('c')], []);

    expect(names(board, 'working')).toEqual(['b', 'a', 'c']);
  });

  it('draws only Idle and Ended quieter', () => {
    const board = new StateBoardViewModel([], []);

    expect(board.columns.filter((each) => each.muted).map((each) => each.id)).toEqual([
      'idle',
      'ended',
    ]);
  });
});

describe('StateBoardViewModel — Show N more', () => {
  const many = [...Array(QUIET_COLUMN_CAP + 3).keys()].map((index) =>
    row(`idle-${String(index)}`, IDLE),
  );

  it('caps a quiet column and says how many it is holding back', () => {
    const idle = column(new StateBoardViewModel(many, []), 'idle');

    expect(idle.rows).toHaveLength(QUIET_COLUMN_CAP);
    expect(idle.hidden).toBe(3);
    expect(idle.count).toBe(QUIET_COLUMN_CAP + 3);
  });

  it('draws the whole column once revealed', () => {
    const idle = column(new StateBoardViewModel(many, [], new Set(['idle'])), 'idle');

    expect(idle.rows).toHaveLength(QUIET_COLUMN_CAP + 3);
    expect(idle.hidden).toBe(0);
  });

  it('never caps Needs you, which is the column the board exists for', () => {
    const asking = many.map((each) => row(each.title, BLOCKED));
    const needs = column(new StateBoardViewModel(asking, []), 'needs-you');

    expect(needs.rows).toHaveLength(asking.length);
    expect(needs.hidden).toBe(0);
  });
});

describe('StateBoardViewModel — panes and shells', () => {
  it('lists the open shells, numbered by the pane they are in', () => {
    const board = new StateBoardViewModel([], [sessionPane('365:a'), shellPane('shell-1')]);
    const shells = column(board, 'shells');

    expect(shells.shells).toEqual([{ key: 'pane-shell-1', title: 'shell-1 · home', pane: 2 }]);
    expect(shells.count).toBe(1);
  });

  it('says which pane a session is in, as the digit that focuses it', () => {
    const board = new StateBoardViewModel([], [shellPane('shell-1'), sessionPane('365:a')]);

    expect(board.paneNumber('365:a')).toBe(2);
    expect(board.paneNumber('365:b')).toBeUndefined();
  });
});
