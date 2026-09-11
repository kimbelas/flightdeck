// Roadmap model, loader, validator and reporter for ROADMAP.yaml.
// Runs directly on Node 26 (erasable TypeScript) — this file is also the P0-T2 proof.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export type Status = 'todo' | 'doing' | 'done' | 'blocked' | 'dropped';
export const STATUSES: readonly Status[] = ['todo', 'doing', 'done', 'blocked', 'dropped'];

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  readonly done_on?: string;
  readonly depends_on?: readonly string[];
}

export interface Phase {
  readonly id: string;
  readonly name: string;
  readonly status: Status;
  readonly gate: string;
  readonly depends_on?: readonly string[];
  readonly tasks: readonly Task[];
}

export interface PendingDecision {
  readonly id: string;
  readonly question: string;
  readonly blocks?: readonly string[];
}

export interface Roadmap {
  readonly version: number;
  readonly project: string;
  readonly updated: string;
  readonly decisions_pending?: readonly PendingDecision[];
  readonly phases: readonly Phase[];
}

export interface Finding {
  readonly level: 'error' | 'warn';
  readonly message: string;
}

export interface PhaseProgress {
  readonly id: string;
  readonly name: string;
  readonly status: Status;
  readonly done: number;
  readonly total: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHASE_ID = /^P\d+[ab]?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTaskLike(value: unknown): value is Task {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['status'] === 'string'
  );
}

function isPhaseLike(value: unknown): value is Phase {
  if (!isRecord(value)) return false;
  const tasks: unknown = value['tasks'];
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['status'] === 'string' &&
    typeof value['gate'] === 'string' &&
    Array.isArray(tasks) &&
    tasks.every(isTaskLike)
  );
}

function isRoadmapLike(value: unknown): value is Roadmap {
  if (!isRecord(value)) return false;
  const phases: unknown = value['phases'];
  return (
    typeof value['version'] === 'number' &&
    typeof value['project'] === 'string' &&
    typeof value['updated'] === 'string' &&
    Array.isArray(phases) &&
    phases.every(isPhaseLike)
  );
}

/** Reads ROADMAP.yaml and proves its shape; semantic checks happen in RoadmapValidator. */
export class RoadmapLoader {
  public load(path: string | URL): Roadmap {
    const parsed: unknown = parse(readFileSync(path, 'utf8'));
    if (!isRoadmapLike(parsed)) {
      throw new Error(
        'ROADMAP.yaml: expected version, project, updated and phases[{id,name,status,gate,tasks[{id,title,status}]}]',
      );
    }
    return parsed;
  }
}

/** Checks ids, statuses, dates, dependencies and phase/task consistency. */
export class RoadmapValidator {
  private readonly roadmap: Roadmap;
  private readonly findings: Finding[] = [];
  private readonly knownIds = new Set<string>();

  constructor(roadmap: Roadmap) {
    this.roadmap = roadmap;
  }

  public validate(): readonly Finding[] {
    this.checkHeader();
    this.collectIds();
    for (const phase of this.roadmap.phases) this.checkPhase(phase);
    this.checkDecisions();
    return this.findings;
  }

  private error(message: string): void {
    this.findings.push({ level: 'error', message });
  }

  private warn(message: string): void {
    this.findings.push({ level: 'warn', message });
  }

  private checkHeader(): void {
    if (this.roadmap.version !== 1)
      this.error(`version must be 1, got ${String(this.roadmap.version)}`);
    if (this.roadmap.project.trim() === '') this.error('project must not be empty');
    if (!ISO_DATE.test(this.roadmap.updated))
      this.error(`updated must be YYYY-MM-DD, got ${this.roadmap.updated}`);
    if (this.roadmap.phases.length === 0) this.error('phases is empty');
  }

  private collectIds(): void {
    for (const phase of this.roadmap.phases) {
      this.register(
        phase.id,
        PHASE_ID.test(phase.id) ? undefined : `phase id ${phase.id} must match P<n>[a|b]`,
      );
      for (const task of phase.tasks) {
        const ok = task.id.startsWith(`${phase.id}-T`);
        this.register(task.id, ok ? undefined : `task ${task.id} must be prefixed ${phase.id}-T`);
      }
    }
    for (const decision of this.roadmap.decisions_pending ?? [])
      this.register(decision.id, undefined);
  }

  private register(id: string, problem: string | undefined): void {
    if (problem !== undefined) this.error(problem);
    if (this.knownIds.has(id)) this.error(`duplicate id ${id}`);
    this.knownIds.add(id);
  }

  private checkPhase(phase: Phase): void {
    if (!STATUSES.includes(phase.status)) this.error(`${phase.id}: unknown status ${phase.status}`);
    if (phase.gate.trim() === '') this.error(`${phase.id}: gate is required`);
    this.checkDependencies(phase.id, phase.depends_on);
    for (const task of phase.tasks) this.checkTask(task);
    this.checkPhaseConsistency(phase);
  }

  private checkTask(task: Task): void {
    if (!STATUSES.includes(task.status)) this.error(`${task.id}: unknown status ${task.status}`);
    if (task.status === 'done' && (task.done_on === undefined || !ISO_DATE.test(task.done_on))) {
      this.error(`${task.id}: done tasks need done_on (YYYY-MM-DD)`);
    }
    if (task.status !== 'done' && task.done_on !== undefined)
      this.warn(`${task.id}: done_on set but status is ${task.status}`);
    this.checkDependencies(task.id, task.depends_on);
  }

  private checkDependencies(owner: string, dependencies: readonly string[] | undefined): void {
    for (const dependency of dependencies ?? []) {
      if (!this.knownIds.has(dependency))
        this.error(`${owner}: depends_on ${dependency} does not exist`);
    }
  }

  private checkPhaseConsistency(phase: Phase): void {
    const statuses = phase.tasks.map((task) => task.status);
    const allDone =
      statuses.length > 0 && statuses.every((status) => status === 'done' || status === 'dropped');
    if (phase.status === 'done' && !allDone)
      this.error(`${phase.id}: marked done but has unfinished tasks`);
    if (phase.status !== 'done' && allDone)
      this.warn(`${phase.id}: every task is done — mark the phase done`);
    if (phase.status === 'todo' && statuses.includes('doing'))
      this.warn(`${phase.id}: has a task in progress — mark the phase doing`);
  }

  private checkDecisions(): void {
    for (const decision of this.roadmap.decisions_pending ?? []) {
      this.checkDependencies(decision.id, decision.blocks);
    }
  }
}

/** Progress numbers and the "next up" list, for the CLI and later for the deck. */
export class RoadmapReporter {
  private readonly roadmap: Roadmap;

  constructor(roadmap: Roadmap) {
    this.roadmap = roadmap;
  }

  public phases(): readonly PhaseProgress[] {
    return this.roadmap.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      status: phase.status,
      done: phase.tasks.filter((task) => task.status === 'done').length,
      total: phase.tasks.filter((task) => task.status !== 'dropped').length,
    }));
  }

  public overallPercent(): number {
    const totals = this.phases().reduce(
      (sum, phase) => ({ done: sum.done + phase.done, total: sum.total + phase.total }),
      { done: 0, total: 0 },
    );
    return totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100);
  }

  public nextUp(limit = 4): readonly Task[] {
    const active = this.roadmap.phases.find((phase) => phase.status !== 'done');
    if (active === undefined) return [];
    const doing = active.tasks.filter((task) => task.status === 'doing');
    const todo = active.tasks.filter((task) => task.status === 'todo');
    return [...doing, ...todo].slice(0, limit);
  }

  public blocked(): readonly Task[] {
    return this.roadmap.phases.flatMap((phase) =>
      phase.tasks.filter((task) => task.status === 'blocked'),
    );
  }
}
