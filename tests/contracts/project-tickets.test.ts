// The rule for what is a ticket on disk, and the wire screen — P9-T3, SEC-UI-2.
import { describe, expect, it } from 'vitest';
import {
  MAX_TICKETS,
  newestTickets,
  parseTicketList,
  ticketIdOf,
} from '../../contracts/project-tickets.ts';
import { parseWorkflowMap } from '../../contracts/workflow-map.ts';

describe('ticketIdOf', () => {
  it('names a spec folder by its own name', () => {
    expect(ticketIdOf('specs', 'XWEB-2126')).toBe('XWEB-2126');
  });

  it('names a state note by its name without `.md`', () => {
    expect(ticketIdOf('state', 'XWEB-1830.md')).toBe('XWEB-1830');
    expect(ticketIdOf('state', 'XWEB-1830.MD')).toBe('XWEB-1830');
  });

  it.each([
    ['state', 'RESUME-PROMPT.md'],
    ['state', 'XWEB-1871-r2.patch'],
    ['state', 'XWEB-1871-r2-files'],
    ['state', 'XWEB-1881-findings.md'],
    ['state', 'archive'],
    ['state', 'commit-msg-1339-app.txt'],
    ['state', 'XWEB-1830'],
    ['specs', 'completed'],
    ['specs', 'XWEB-2126.md'],
    ['specs', '..'],
  ] as const)('refuses %s/%s', (folder, entry) => {
    expect(ticketIdOf(folder, entry)).toBeUndefined();
  });

  it('upper-cases, as `TicketPrompt` does to a typed id', () => {
    expect(ticketIdOf('specs', 'xweb-9')).toBe('XWEB-9');
  });
});

describe('newestTickets', () => {
  it('orders newest first and breaks a tie on the id', () => {
    expect(
      newestTickets([
        { id: 'B-1', modifiedAt: 5 },
        { id: 'A-1', modifiedAt: 5 },
        { id: 'C-1', modifiedAt: 9 },
      ]),
    ).toEqual(['C-1', 'A-1', 'B-1']);
  });

  it('keeps one entry per id, at its later mtime', () => {
    expect(
      newestTickets([
        { id: 'A-1', modifiedAt: 1 },
        { id: 'B-1', modifiedAt: 5 },
        { id: 'A-1', modifiedAt: 9 },
      ]),
    ).toEqual(['A-1', 'B-1']);
  });
});

describe('parseTicketList', () => {
  it('drops what is not ticket-shaped, and repeats', () => {
    expect(
      parseTicketList(['XWEB-1', '<img src=x>', 'xweb-1', 7, 'XWEB-1881-findings', 'AB-2']),
    ).toEqual(['XWEB-1', 'AB-2']);
  });

  it('answers nothing for a body that is not a list', () => {
    expect(parseTicketList(undefined)).toEqual([]);
    expect(parseTicketList('XWEB-1')).toEqual([]);
  });

  it('stops at MAX_TICKETS', () => {
    const many = [...Array(MAX_TICKETS + 10).keys()].map((n) => `TK-${String(n)}`);
    expect(parseTicketList(many)).toHaveLength(MAX_TICKETS);
  });

  it('is what a map from the wire carries, empty when the field is absent', () => {
    expect(parseWorkflowMap({ path: 'C:\\x', at: 1, tickets: ['XWEB-3'] })?.tickets).toEqual([
      'XWEB-3',
    ]);
    expect(parseWorkflowMap({ path: 'C:\\x', at: 1 })?.tickets).toEqual([]);
  });
});
