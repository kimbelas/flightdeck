import { describe, expect, it } from 'vitest';
import {
  RoadmapLoader,
  RoadmapReporter,
  RoadmapValidator,
  type Roadmap,
  type Status,
} from '../scripts/roadmap.ts';

const ROADMAP_URL = new URL('../ROADMAP.yaml', import.meta.url);

function roadmapWith(overrides: Partial<Roadmap>): Roadmap {
  return {
    version: 1,
    project: 'flightdeck',
    updated: '2026-09-10',
    phases: [
      {
        id: 'P0',
        name: 'Spikes',
        status: 'doing',
        gate: 'All spikes captured.',
        tasks: [
          { id: 'P0-T1', title: 'node-pty', status: 'done', done_on: '2026-09-10' },
          { id: 'P0-T2', title: 'hooks', status: 'todo' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('ROADMAP.yaml (the real file)', () => {
  it('has no validation errors', () => {
    const roadmap = new RoadmapLoader().load(ROADMAP_URL);
    const errors = new RoadmapValidator(roadmap)
      .validate()
      .filter((finding) => finding.level === 'error');
    expect(errors).toEqual([]);
  });

  it('reports progress without throwing', () => {
    const reporter = new RoadmapReporter(new RoadmapLoader().load(ROADMAP_URL));
    expect(reporter.phases().length).toBeGreaterThan(0);
    expect(reporter.overallPercent()).toBeGreaterThanOrEqual(0);
  });
});

describe('RoadmapValidator', () => {
  it('accepts a well-formed roadmap', () => {
    expect(new RoadmapValidator(roadmapWith({})).validate()).toEqual([]);
  });

  it('rejects a done task without a date', () => {
    const roadmap = roadmapWith({
      phases: [
        {
          id: 'P0',
          name: 'x',
          status: 'doing',
          gate: 'g',
          tasks: [{ id: 'P0-T1', title: 't', status: 'done' }],
        },
      ],
    });
    const messages = new RoadmapValidator(roadmap).validate().map((finding) => finding.message);
    expect(messages).toContain('P0-T1: done tasks need done_on (YYYY-MM-DD)');
  });

  it('rejects unknown dependencies and duplicate ids', () => {
    const roadmap = roadmapWith({
      phases: [
        {
          id: 'P0',
          name: 'x',
          status: 'todo',
          gate: 'g',
          tasks: [
            { id: 'P0-T1', title: 't', status: 'todo', depends_on: ['P9-T9'] },
            { id: 'P0-T1', title: 'dup', status: 'todo' },
          ],
        },
      ],
    });
    const messages = new RoadmapValidator(roadmap).validate().map((finding) => finding.message);
    expect(messages).toContain('P0-T1: depends_on P9-T9 does not exist');
    expect(messages).toContain('duplicate id P0-T1');
  });

  it('rejects a phase marked done with open tasks', () => {
    const roadmap = roadmapWith({
      phases: [
        {
          id: 'P1',
          name: 'x',
          status: 'done',
          gate: 'g',
          tasks: [{ id: 'P1-T1', title: 't', status: 'todo' }],
        },
      ],
    });
    const errors = new RoadmapValidator(roadmap)
      .validate()
      .filter((finding) => finding.level === 'error');
    expect(errors.map((finding) => finding.message)).toContain(
      'P1: marked done but has unfinished tasks',
    );
  });
});

describe('a phase nobody is going to build', () => {
  /** P5b, DECISIONS.md D52 — dropped by the owner rather than deleted from the file. */
  const dropped = (status: Status): Roadmap =>
    roadmapWith({
      phases: [
        {
          id: 'P0',
          name: 'Spikes',
          status: 'done',
          gate: 'g',
          tasks: [{ id: 'P0-T1', title: 'a', status: 'done', done_on: '2026-09-10' }],
        },
        {
          id: 'P1',
          name: 'Parked',
          status,
          gate: 'g',
          tasks: [{ id: 'P1-T1', title: 'b', status: 'dropped' }],
        },
        {
          id: 'P2',
          name: 'Next',
          status: 'todo',
          gate: 'g',
          tasks: [{ id: 'P2-T1', title: 'c', status: 'todo' }],
        },
      ],
    });

  it('asks for it to be marked dropped, never done — those are different things to read', () => {
    const findings = new RoadmapValidator(dropped('todo')).validate();
    expect(findings.map((finding) => finding.message)).toEqual([
      'P1: every task is dropped — mark the phase dropped',
    ]);
  });

  it('says nothing once it is', () => {
    expect(new RoadmapValidator(dropped('dropped')).validate()).toEqual([]);
  });

  /**
   * The bug this pins shipped for as long as it took to run the CLI once.
   *
   * P5b sits between P5a and P6, so the moment it was dropped it became the first phase that was
   * not `done` — and "next up" went empty while P6 had seven tasks waiting in it.
   */
  it('is skipped when looking for what to do next', () => {
    const reporter = new RoadmapReporter(dropped('dropped'));
    expect(reporter.nextUp().map((task) => task.id)).toEqual(['P2-T1']);
  });

  it('counts for nothing in the percentage rather than counting against it', () => {
    const reporter = new RoadmapReporter(dropped('dropped'));
    // Two tasks are real, one of them is done. The dropped one is in neither total.
    expect(reporter.overallPercent()).toBe(50);
    expect(reporter.phases().find((phase) => phase.id === 'P1')).toMatchObject({
      done: 0,
      total: 0,
    });
  });
});

describe('RoadmapReporter', () => {
  it('computes percent and next-up from the active phase', () => {
    const reporter = new RoadmapReporter(roadmapWith({}));
    expect(reporter.overallPercent()).toBe(50);
    expect(reporter.nextUp().map((task) => task.id)).toEqual(['P0-T2']);
  });

  /**
   * 2026-09-25, D59: P8 and P9 were sequenced ahead of P7-T2..T5 with a `depends_on`, and "next
   * up" — which read the first unfinished phase and nothing else — would have kept naming the
   * search UI. The shape below is the real file's, reduced: P7 first with one ready task, P8
   * waiting on it, P9 ready, and a task in P7 waiting on P9.
   */
  it('skips what waits on unfinished work, and looks past the first unfinished phase', () => {
    const reporter = new RoadmapReporter(
      roadmapWith({
        phases: [
          {
            id: 'P7',
            name: 'Search',
            status: 'todo',
            gate: 'g',
            tasks: [
              { id: 'P7-T1', title: 'index', status: 'todo' },
              { id: 'P7-T2', title: 'search ui', status: 'todo', depends_on: ['P9'] },
            ],
          },
          {
            id: 'P8',
            name: 'Phone',
            status: 'todo',
            gate: 'g',
            depends_on: ['P7-T1'],
            tasks: [{ id: 'P8-T1', title: 'always on', status: 'todo' }],
          },
          {
            id: 'P9',
            name: 'One press',
            status: 'todo',
            gate: 'g',
            tasks: [
              { id: 'P9-T1', title: 'agent', status: 'doing' },
              { id: 'P9-T2', title: 'map', status: 'todo', depends_on: ['P9-T1'] },
            ],
          },
        ],
      }),
    );
    // `doing` first wherever it sits; then the two ready `todo`s; nothing that waits.
    expect(reporter.nextUp().map((task) => task.id)).toEqual(['P9-T1', 'P7-T1']);
  });

  it('treats a dropped dependency as settled rather than as forever unfinished', () => {
    const reporter = new RoadmapReporter(
      roadmapWith({
        phases: [
          {
            id: 'P5b',
            name: 'Tauri',
            status: 'dropped',
            gate: 'g',
            tasks: [{ id: 'P5b-T1', title: 'probe', status: 'dropped' }],
          },
          {
            id: 'P6',
            name: 'Next',
            status: 'todo',
            gate: 'g',
            depends_on: ['P5b'],
            tasks: [{ id: 'P6-T1', title: 'a', status: 'todo', depends_on: ['P5b-T1'] }],
          },
        ],
      }),
    );
    expect(reporter.nextUp().map((task) => task.id)).toEqual(['P6-T1']);
  });
});
