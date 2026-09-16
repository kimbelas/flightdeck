// The registry, from the deck's side — P3-T1, DECISIONS.md D26.
//
// A separate file from `deck-store-requests.test.ts` for the reason that one is separate from
// `deck-store.test.ts`: these are the only store paths that are neither the stream nor the session
// table, and the rule they are here to pin is the one a "helpful" change would break first — an
// empty registry is a real state, so nothing here may fill it in, and a failed request must not
// empty it.
import { describe, expect, it } from 'vitest';
import {
  CORE_PROJECT_FORGET_PATH,
  CORE_PROJECT_STATUS_PATH,
  CORE_PROJECTS_PATH,
} from '../../contracts/deck-routes.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import type { ProjectStatus } from '../../contracts/project-status.ts';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const APP_NEXT: ProjectRecord = {
  path: 'C:\\Users\\belas\\Documents\\development\\app-next',
  name: 'app-next',
  importedAt: 1_700_000_000_000,
};

/** The stream is not under test here, so the transport does nothing and is never connected. */
class IdleTransport implements StreamTransport {
  public open(): EventStreamSource {
    return { on: () => undefined, close: () => undefined };
  }

  public wait(): () => void {
    return () => undefined;
  }
}

function rig(): { store: DeckStore; api: FakeDeckApi } {
  const api = new FakeDeckApi();
  return { store: new DeckStore(new IdleTransport(), api), api };
}

function listing(...projects: readonly ProjectRecord[]): unknown {
  return { projects };
}

describe('DeckStore.loadProjects', () => {
  it('starts with nothing, and asks through the rewrite', async () => {
    const { store, api } = rig();
    api.willAnswer(200, listing());

    expect(store.snapshot().projects).toEqual([]);
    await store.loadProjects();

    expect(api.requests).toEqual([
      { method: 'GET', path: CORE_PROJECTS_PATH, body: undefined },
      // The readings follow the list, and cost nothing on a registry with nothing in it (P3-T2).
      { method: 'GET', path: CORE_PROJECT_STATUS_PATH, body: undefined },
    ]);
    // Still empty, and that is the answer rather than a failure: the registry ships empty (D26).
    expect(store.snapshot().projects).toEqual([]);
  });

  it('reads the registry', async () => {
    const { store, api } = rig();
    api.willAnswer(200, listing(APP_NEXT));

    await store.loadProjects();

    expect(store.snapshot().projects).toEqual([APP_NEXT]);
  });

  it('drops a row it cannot read rather than the whole list', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { projects: [APP_NEXT, { name: 'nameless' }] });

    await store.loadProjects();

    expect(store.snapshot().projects).toEqual([APP_NEXT]);
  });

  it('keeps what it has when the request fails, rather than reporting an empty registry', async () => {
    // The case worth the file. An empty registry is an ordinary state, so rendering one because
    // core blinked would tell the owner their projects are gone.
    const { store, api } = rig();
    api.willAnswer(200, listing(APP_NEXT));
    await store.loadProjects();

    api.willNotAnswer();
    await store.loadProjects();

    expect(store.snapshot().projects).toEqual([APP_NEXT]);
  });

  it('keeps what it has when core answers something that is not a registry', async () => {
    const { store, api } = rig();
    api.willAnswer(200, listing(APP_NEXT));
    await store.loadProjects();

    api.willAnswer(503, { error: 'nope' });
    await store.loadProjects();

    expect(store.snapshot().projects).toEqual([APP_NEXT]);
  });
});

describe('DeckStore.importProject', () => {
  it('posts the path and re-reads the registry from core', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECTS_PATH, 201, { project: APP_NEXT });

    const imported = await store.importProject(APP_NEXT.path);

    expect(imported).toBe(true);
    // Two, not three: this rig answers the re-read with the import's own 201, and a list that did
    // not come back is not one to fetch readings for (P3-T2).
    expect(api.requests.map((request) => request.method)).toEqual(['POST', 'GET']);
    expect(api.requests[0]?.body).toEqual({ path: APP_NEXT.path });
  });

  it('shows the list core answers with, never one it assembled itself', async () => {
    // The row comes from the re-read, not from the 201's body: what the registry holds is core's
    // answer, and a deck that appended the row itself would be guessing at the outcome of a write.
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECTS_PATH, 201, { project: APP_NEXT });
    await store.importProject(APP_NEXT.path);

    expect(store.snapshot().projects).toEqual([]);

    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing(APP_NEXT));
    await store.loadProjects();

    expect(store.snapshot().projects).toEqual([APP_NEXT]);
  });

  it('keeps core\u2019s refusal code, so the panel can put it into English', async () => {
    const { store, api } = rig();
    api.willAnswer(400, { error: 'config_directory' });

    const imported = await store.importProject('C:\\Users\\belas\\.claude-365');

    expect(imported).toBe(false);
    expect(store.snapshot().importRefusal).toBe('config_directory');
  });

  it('falls back to a refusal it knows when core sends one it does not', async () => {
    // A code from a newer build, an HTML error page, a request that reached nobody — all render as
    // something rather than as silence, and none of them puts core's text on the screen.
    for (const reply of [{ error: 'brand_new' }, '<html>', undefined]) {
      const { store, api } = rig();
      if (reply === undefined) api.willNotAnswer();
      else api.willAnswer(400, reply);

      await store.importProject('C:\\x');

      expect(store.snapshot().importRefusal).toBe('empty');
    }
  });

  it('clears the last refusal when the next import is taken', async () => {
    const { store, api } = rig();
    api.willAnswer(400, { error: 'missing' });
    await store.importProject('Z:\\nothing');

    api.willAnswerPath(CORE_PROJECTS_PATH, 201, { project: APP_NEXT });
    await store.importProject(APP_NEXT.path);

    expect(store.snapshot().importRefusal).toBeUndefined();
  });
});

describe('DeckStore.forgetProject', () => {
  it('posts the path to the forget route and re-reads the registry', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECT_FORGET_PATH, 200, { forgotten: true });
    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing());

    await store.forgetProject(APP_NEXT.path);

    expect(api.requests).toEqual([
      { method: 'POST', path: CORE_PROJECT_FORGET_PATH, body: { path: APP_NEXT.path } },
      { method: 'GET', path: CORE_PROJECTS_PATH, body: undefined },
      { method: 'GET', path: CORE_PROJECT_STATUS_PATH, body: undefined },
    ]);
    expect(store.snapshot().projects).toEqual([]);
  });

  it('does not re-read when the request reached nobody', async () => {
    const { store, api } = rig();
    api.willNotAnswer();

    await store.forgetProject(APP_NEXT.path);

    expect(api.requests.map((request) => request.method)).toEqual(['POST']);
  });
});

const READING: ProjectStatus = {
  path: APP_NEXT.path,
  at: 1_700_000_000_000,
  stack: ['Next.js', 'Node'],
  git: { branch: 'main', ahead: 0, behind: 0, dirty: 2, conflicts: 0, progress: undefined },
};

describe('DeckStore.loadProjectStatuses', () => {
  it('follows the registry read, so a row and its branch arrive together', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing(APP_NEXT));
    api.willAnswerPath(CORE_PROJECT_STATUS_PATH, 200, { statuses: [READING] });

    await store.loadProjects();

    expect(store.snapshot().statuses[projectKey(APP_NEXT.path)]).toEqual(READING);
  });

  it('keys the readings the way the panel keys its rows', async () => {
    // Two spellings of one folder are one project, so the key has to be the folded one or the
    // reading lands on no row at all.
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing(APP_NEXT));
    api.willAnswerPath(CORE_PROJECT_STATUS_PATH, 200, {
      statuses: [{ ...READING, path: APP_NEXT.path.toUpperCase() }],
    });

    await store.loadProjects();

    expect(Object.keys(store.snapshot().statuses)).toEqual([projectKey(APP_NEXT.path)]);
  });

  it('replaces what is held rather than merging, so a forgotten folder loses its branch', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing(APP_NEXT));
    api.willAnswerPath(CORE_PROJECT_STATUS_PATH, 200, { statuses: [READING] });
    await store.loadProjects();

    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing());
    api.willAnswerPath(CORE_PROJECT_STATUS_PATH, 200, { statuses: [] });
    await store.loadProjects();

    expect(store.snapshot().statuses).toEqual({});
  });

  it('keeps what it has when the request fails, rather than blanking every row', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing(APP_NEXT));
    api.willAnswerPath(CORE_PROJECT_STATUS_PATH, 200, { statuses: [READING] });
    await store.loadProjects();

    api.willNotAnswer();
    await store.loadProjectStatuses();

    expect(store.snapshot().statuses[projectKey(APP_NEXT.path)]).toEqual(READING);
  });

  it('drops a reading it cannot read rather than the whole set', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PROJECTS_PATH, 200, listing(APP_NEXT));
    api.willAnswerPath(CORE_PROJECT_STATUS_PATH, 200, { statuses: [READING, { at: 2 }] });

    await store.loadProjects();

    expect(Object.keys(store.snapshot().statuses)).toHaveLength(1);
  });

  it('does not ask for readings when the registry itself could not be read', async () => {
    // Nothing to annotate, and a second request for it would be a second failure to report.
    const { store, api } = rig();
    api.willAnswer(503, { error: 'nope' });

    await store.loadProjects();

    expect(api.requests.map((request) => request.path)).toEqual([CORE_PROJECTS_PATH]);
  });
});
