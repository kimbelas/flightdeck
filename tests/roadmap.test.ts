import { describe, expect, it } from 'vitest';
import {
  RoadmapLoader,
  RoadmapReporter,
  RoadmapValidator,
  type Roadmap,
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

describe('RoadmapReporter', () => {
  it('computes percent and next-up from the active phase', () => {
    const reporter = new RoadmapReporter(roadmapWith({}));
    expect(reporter.overallPercent()).toBe(50);
    expect(reporter.nextUp().map((task) => task.id)).toEqual(['P0-T2']);
  });
});
