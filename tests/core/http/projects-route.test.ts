// The four project routes — P3-T1 and P3-T2, SEC-FS-1.
//
// Each is tested against its own one-method interface rather than a `ProjectRegistry`, which is
// what those interfaces are for: proving that a body with no `path` never reaches an importer
// should not require a store, a clock, an audit log and a path canonicaliser.
import { describe, expect, it } from 'vitest';
import type { ImportRefusal, ProjectRecord } from '../../../contracts/project.ts';
import { ForgetProjectRoute } from '../../../core/http/forget-project-route.ts';
import { ImportProjectRoute } from '../../../core/http/import-project-route.ts';
import { ProjectStatusRoute } from '../../../core/http/project-status-route.ts';
import { WorkflowMapRoute } from '../../../core/http/workflow-map-route.ts';
import { ProjectsRoute } from '../../../core/http/projects-route.ts';
import type { ProjectStatus } from '../../../contracts/project-status.ts';
import type { WorkflowMap } from '../../../contracts/workflow-map.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';

const PATH = 'C:\\Users\\belas\\Documents\\development\\app-next';
const PROJECT: ProjectRecord = { path: PATH, name: 'app-next', importedAt: 1_700_000_000_000 };
const FACTS: RequestFacts = { method: 'POST', url: '/projects', headers: {} };

class RecordingImporter {
  public readonly asked: string[] = [];
  private readonly answer: Result<ProjectRecord, ImportRefusal>;

  constructor(answer: Result<ProjectRecord, ImportRefusal>) {
    this.answer = answer;
  }

  public import(path: string): Promise<Result<ProjectRecord, ImportRefusal>> {
    this.asked.push(path);
    return Promise.resolve(this.answer);
  }
}

class RecordingForgetter {
  public readonly asked: string[] = [];
  private readonly answer: boolean;

  constructor(answer: boolean) {
    this.answer = answer;
  }

  public forget(path: string): boolean {
    this.asked.push(path);
    return this.answer;
  }
}

describe('ProjectsRoute', () => {
  it('is a GET on /projects, spending the control budget', () => {
    const route = new ProjectsRoute({ list: () => [] });

    expect([route.method, route.path, route.limit, route.credential]).toEqual([
      'GET',
      '/projects',
      'control',
      'token',
    ]);
  });

  it('answers with an empty list on a machine that has imported nothing (D26)', () => {
    expect(new ProjectsRoute({ list: () => [] }).handle()).toEqual({
      status: 200,
      body: { projects: [] },
    });
  });

  it('wraps the registry in an object, not a bare array', () => {
    // A top-level JSON array is a shape that cannot grow a field, and every other route here
    // answers with an object.
    expect(new ProjectsRoute({ list: () => [PROJECT] }).handle().body).toEqual({
      projects: [PROJECT],
    });
  });
});

describe('ImportProjectRoute', () => {
  it('is a POST on /projects', () => {
    const route = new ImportProjectRoute(new RecordingImporter(ok(PROJECT)));

    expect([route.method, route.path, route.credential]).toEqual(['POST', '/projects', 'token']);
  });

  it('answers 201 with the stored project', async () => {
    const route = new ImportProjectRoute(new RecordingImporter(ok(PROJECT)));

    expect(await route.handle(FACTS, JSON.stringify({ path: PATH }))).toEqual({
      status: 201,
      body: { project: PROJECT },
    });
  });

  it('hands the path over untouched — every rule about it is the registry\u2019s', async () => {
    const importer = new RecordingImporter(ok(PROJECT));

    await new ImportProjectRoute(importer).handle(FACTS, JSON.stringify({ path: ' C:/dev/x ' }));

    expect(importer.asked).toEqual([' C:/dev/x ']);
  });

  it('repeats the refusal code back, because a person typed the path', async () => {
    // The opposite call from `SessionDetailRoute`'s: the deck composes that URL from a row it
    // already has, while this one came out of a text box somebody is looking at. `ImportRefusal`
    // is a closed union with no free text, so nothing echoed here was composed from the request.
    const route = new ImportProjectRoute(new RecordingImporter(err('config_directory')));

    expect(await route.handle(FACTS, JSON.stringify({ path: PATH }))).toEqual({
      status: 400,
      body: { error: 'config_directory' },
    });
  });

  const nothing: readonly [string, string][] = [
    ['', 'an empty body'],
    ['not json', 'a body that is not JSON'],
    ['[]', 'a JSON array'],
    ['{}', 'an object with no path'],
    ['{"path":42}', 'a path that is not a string'],
    ['{"path":"  "}', 'a path of only whitespace'],
  ];

  for (const [body, what] of nothing) {
    it(`refuses ${what} as empty, without asking the registry`, async () => {
      const importer = new RecordingImporter(ok(PROJECT));

      const reply = await new ImportProjectRoute(importer).handle(FACTS, body);

      expect(reply).toEqual({ status: 400, body: { error: 'empty' } });
      expect(importer.asked).toEqual([]);
    });
  }
});

describe('ForgetProjectRoute', () => {
  it('is a POST on its own literal path, because the router has no patterns', () => {
    const route = new ForgetProjectRoute(new RecordingForgetter(true));

    expect([route.method, route.path]).toEqual(['POST', '/projects/forget']);
  });

  it('answers 200 with whether anything was actually withdrawn', () => {
    const route = new ForgetProjectRoute(new RecordingForgetter(true));

    expect(route.handle(FACTS, JSON.stringify({ path: PATH }))).toEqual({
      status: 200,
      body: { forgotten: true },
    });
  });

  it('is a 200 for a path that was never imported, not a 404', () => {
    // The request asked for a state — "this folder is not a project" — and that state holds either
    // way. A 404 would make the deck render an error for the outcome the owner wanted.
    const reply = new ForgetProjectRoute(new RecordingForgetter(false)).handle(
      FACTS,
      JSON.stringify({ path: PATH }),
    );

    expect(reply).toEqual({ status: 200, body: { forgotten: false } });
  });

  it('refuses a body with no path without asking the registry', () => {
    const forgetter = new RecordingForgetter(true);

    expect(new ForgetProjectRoute(forgetter).handle(FACTS, '{}').status).toBe(400);
    expect(forgetter.asked).toEqual([]);
  });
});

describe('ProjectStatusRoute', () => {
  const READING: ProjectStatus = {
    path: PATH,
    at: 1_700_000_000_000,
    stack: ['Next.js', 'Node'],
    git: { branch: 'main', ahead: 0, behind: 0, dirty: 2, conflicts: 0, progress: undefined },
  };

  it('is a GET on its own literal path, beside the registry rather than inside it', () => {
    // Its own path because the costs differ: listing the registry opens nothing, and this may
    // spawn a `git` per project.
    const route = new ProjectStatusRoute({ readAll: () => Promise.resolve([]) });

    expect([route.method, route.path]).toEqual(['GET', '/projects/status']);
  });

  it('answers every reading in one reply, wrapped in an object', async () => {
    // Wrapped for the reason `ProjectsRoute` gives: a top-level array cannot grow a field.
    const route = new ProjectStatusRoute({ readAll: () => Promise.resolve([READING]) });

    expect(await route.handle()).toEqual({ status: 200, body: { statuses: [READING] } });
  });

  it('answers an empty list on a machine that has imported nothing', async () => {
    const route = new ProjectStatusRoute({ readAll: () => Promise.resolve([]) });

    expect(await route.handle()).toEqual({ status: 200, body: { statuses: [] } });
  });

  it('spends the control budget and needs the token, like every other project route', () => {
    const route = new ProjectStatusRoute({ readAll: () => Promise.resolve([]) });

    expect([route.limit, route.credential]).toEqual(['control', 'token']);
  });
});

describe('WorkflowMapRoute', () => {
  const MAP: WorkflowMap = {
    path: PATH,
    at: 1_700_000_000_000,
    instructions: [{ source: 'claude-md', bytes: 3482 }],
    assets: [],
    hooks: [],
    servers: [],
    plugins: [],
    marketplaces: [],
    permissions: { allow: [], deny: [], ask: [], defaultMode: undefined },
    conventions: [],
    worktrees: [],
    configured: false,
  };

  it('is a GET on its own literal path — a third cost beside the other two', () => {
    const route = new WorkflowMapRoute({ readAll: () => Promise.resolve([]) });

    expect([route.method, route.path]).toEqual(['GET', '/projects/map']);
  });

  it('answers every map in one reply, wrapped in an object', async () => {
    const route = new WorkflowMapRoute({ readAll: () => Promise.resolve([MAP]) });

    expect(await route.handle()).toEqual({ status: 200, body: { maps: [MAP] } });
  });

  it('answers an empty list on a machine that has imported nothing', async () => {
    const route = new WorkflowMapRoute({ readAll: () => Promise.resolve([]) });

    expect(await route.handle()).toEqual({ status: 200, body: { maps: [] } });
  });

  it('spends the control budget and needs the token, like every other project route', () => {
    const route = new WorkflowMapRoute({ readAll: () => Promise.resolve([]) });

    expect([route.limit, route.credential]).toEqual(['control', 'token']);
  });
});
