// `GET /projects/observed` — P3-T5.
//
// The aggregation is `ObservedTally`'s and is tested there. What is this route's own is that a
// path is LOOKED UP in the registry rather than used, that an unimported one reads nothing, and
// that one project is answered per request.
import { describe, expect, it } from 'vitest';
import type { ObservedBehaviour } from '../../../contracts/observed-behaviour.ts';
import type { ProjectRecord } from '../../../contracts/project.ts';
import { ObservedRoute, type ObservedSource } from '../../../core/http/observed-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';

const LEDGER: ProjectRecord = {
  path: String.raw`C:\dev\ledger`,
  name: 'ledger',
  importedAt: 1,
};

function reading(path: string): ObservedBehaviour {
  return {
    path,
    at: 100,
    tookMs: 7,
    sessions: 2,
    sessionsThisWeek: 1,
    bytesRead: 4096,
    shares: [{ subscription: '365', sessions: 2, costUsd: 1.5 }],
    tools: [{ name: 'Bash', count: 9 }],
    skills: [],
    sessionNames: [],
    files: [],
    medianPeakContextTokens: 42_000,
    compactions: 0,
    scheduledFires: 0,
    schedules: [],
    unknownLines: 0,
  };
}

interface Harness {
  readonly route: ObservedRoute;
  readonly read: string[];
}

function harness(projects: readonly ProjectRecord[] = [LEDGER]): Harness {
  const read: string[] = [];
  const source: ObservedSource = {
    find: (path) => projects.find((project) => project.path === path),
    read: (project) => {
      read.push(project.path);
      return Promise.resolve(reading(project.path));
    },
  };
  return { route: new ObservedRoute(source), read };
}

function get(url: string): RequestFacts {
  return { method: 'GET', url, headers: {} };
}

describe('ObservedRoute', () => {
  it('answers the reading for an imported folder', async () => {
    const { route, read } = harness();

    const answer = await route.handle(
      get(`/projects/observed?path=${encodeURIComponent(LEDGER.path)}`),
    );

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      path: LEDGER.path,
      sessions: 2,
      tools: [{ name: 'Bash' }],
    });
    expect(read).toEqual([LEDGER.path]);
  });

  /**
   * The control this route exists to keep.
   *
   * A path nobody imported is a 404 and, more importantly, is never READ: the registry is what
   * turns a path into a project (D26, SEC-FS-1), and a route that read whatever it was handed
   * would be a way to ask core to walk an arbitrary directory of a config dir.
   */
  it('refuses a folder nobody imported, and opens nothing', async () => {
    const { route, read } = harness();

    const answer = await route.handle(get('/projects/observed?path=C:%5CWindows%5CTemp'));

    expect(answer.status).toBe(404);
    expect(read).toEqual([]);
  });

  it('refuses a request with no path at all rather than answering about something', async () => {
    const { route, read } = harness();

    for (const url of [
      '/projects/observed',
      '/projects/observed?path=',
      '/projects/observed?x=1',
    ]) {
      expect((await route.handle(get(url))).status, url).toBe(400);
    }
    expect(read).toEqual([]);
  });

  it('spends the control budget and needs the token', () => {
    const { route } = harness();

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/projects/observed');
    expect(route.limit).toBe('control');
    expect(route.credential).toBe('token');
  });

  it('answers about ONE project per request — the whole reason it is not on /projects/status', async () => {
    const other: ProjectRecord = { path: String.raw`C:\dev\atlas`, name: 'atlas', importedAt: 2 };
    const { route, read } = harness([LEDGER, other]);

    await route.handle(get(`/projects/observed?path=${encodeURIComponent(other.path)}`));

    expect(read).toEqual([other.path]);
  });
});
