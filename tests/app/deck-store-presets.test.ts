// Presets, from the deck's side — P4-T1.
//
// A separate file from `deck-store-projects.test.ts` for the reason that one is separate from
// `deck-store.test.ts`: these are the store paths that write to a project rather than read one.
// The rules pinned here are the ones a "helpful" change would break first — a failed read must not
// empty the list, a save must re-read rather than guess at what core did with it, and a preset
// launch must carry its folder, which is the field core silently dropped until this task.
import { describe, expect, it } from 'vitest';
import {
  CORE_PRESET_FORGET_PATH,
  CORE_PRESETS_PATH,
  CORE_SESSIONS_PATH,
} from '../../contracts/deck-routes.ts';
import { projectKey } from '../../contracts/project.ts';
import type { LaunchPreset, PresetDraft } from '../../contracts/launch-preset.ts';
import {
  DeckStore,
  type EventStreamSource,
  type StreamTransport,
} from '../../app/deck/deck-store.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const APP_NEXT = 'C:\\Users\\belas\\Documents\\development\\app-next';

const PRESET: LaunchPreset = {
  projectKey: projectKey(APP_NEXT),
  id: 'ticket',
  name: 'ticket',
  profileFn: 'claude-isg-ticket',
  cwd: APP_NEXT,
  sessionName: 'XWEB-2019',
  promptSource: 'ticket',
  prompt: '',
  group: undefined,
  builtIn: true,
};

const DRAFT: PresetDraft = {
  projectPath: APP_NEXT,
  name: 'ticket',
  profileFn: 'claude-isg-ticket',
  cwd: '',
  sessionName: 'XWEB-2019',
  promptSource: 'ticket',
  prompt: '',
  group: undefined,
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

describe('DeckStore — reading presets', () => {
  it('asks core for them beside the registry, not on a timer', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { projects: [] });
    api.willAnswerPath(CORE_PRESETS_PATH, 200, { presets: [PRESET] });

    await store.loadProjects();

    expect(api.requests.some((request) => request.path === CORE_PRESETS_PATH)).toBe(true);
    expect(store.snapshot().presets).toEqual([PRESET]);
  });

  it('drops a row it cannot read rather than refusing the list', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { projects: [] });
    api.willAnswerPath(CORE_PRESETS_PATH, 200, {
      presets: [PRESET, { profileFn: 'claude-isg-agents' }],
    });

    await store.loadProjects();

    expect(store.snapshot().presets).toEqual([PRESET]);
  });

  it('leaves what is held alone when the read fails', async () => {
    const { store, api } = rig();
    api.willAnswer(200, { projects: [] });
    api.willAnswerPath(CORE_PRESETS_PATH, 200, { presets: [PRESET] });
    await store.loadProjects();

    api.willAnswerPath(CORE_PRESETS_PATH, 503, {});
    await store.loadProjects();

    expect(store.snapshot().presets).toEqual([PRESET]);
  });
});

describe('DeckStore — saving a preset', () => {
  it('posts the draft and re-reads the list rather than patching it locally', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PRESETS_PATH, 201, { preset: PRESET });

    const saved = await store.savePreset(DRAFT);

    expect(saved).toBe(true);
    const posts = api.requests.filter((request) => request.method === 'POST');
    expect(posts[0]?.body).toEqual(DRAFT);
    // A save that replaced a built-in, a save that replaced a row and a save that added one all
    // look the same from here, so the list is core's answer rather than a guess.
    expect(api.requests.filter((request) => request.method === 'GET')).toHaveLength(1);
  });

  it('keeps core’s refusal code for the panel to put into English', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PRESETS_PATH, 400, { error: 'bad_cwd' });

    expect(await store.savePreset(DRAFT)).toBe(false);
    expect(store.snapshot().presetRefusal).toBe('bad_cwd');
  });

  it('falls back to `empty` for a refusal this build does not know', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PRESETS_PATH, 400, { error: 'teapot' });

    await store.savePreset(DRAFT);

    expect(store.snapshot().presetRefusal).toBe('empty');
  });

  it('clears the refusal once a save is taken', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PRESETS_PATH, 400, { error: 'bad_name' });
    await store.savePreset(DRAFT);

    api.willAnswerPath(CORE_PRESETS_PATH, 201, { preset: PRESET });
    await store.savePreset(DRAFT);

    expect(store.snapshot().presetRefusal).toBeUndefined();
  });
});

describe('DeckStore — forgetting a preset', () => {
  it('posts the ref and re-reads', async () => {
    const { store, api } = rig();
    api.willAnswerPath(CORE_PRESET_FORGET_PATH, 200, { forgotten: true });
    api.willAnswerPath(CORE_PRESETS_PATH, 200, { presets: [PRESET] });

    await store.forgetPreset({ projectPath: APP_NEXT, id: 'ticket' });

    const post = api.requests.find((request) => request.path === CORE_PRESET_FORGET_PATH);
    expect(post?.body).toEqual({ projectPath: APP_NEXT, id: 'ticket' });
    expect(store.snapshot().presets).toEqual([PRESET]);
  });

  it('does not re-read when the request reached nobody', async () => {
    const { store, api } = rig();
    api.willNotAnswer();

    await store.forgetPreset({ projectPath: APP_NEXT, id: 'ticket' });

    expect(api.requests.filter((request) => request.method === 'GET')).toEqual([]);
  });
});

describe('DeckStore — starting a session from a preset', () => {
  it('sends the folder, which is the field a plain launch has nothing to put in', async () => {
    const { store, api } = rig();
    api.willAnswer(201, { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });

    const started = await store.launch({
      profileFn: 'claude-isg-ticket',
      prompt: 'plan ticket XWEB-2019',
      name: 'XWEB-2019',
      cwd: APP_NEXT,
    });

    expect(started).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(api.requests[0]).toEqual({
      method: 'POST',
      path: CORE_SESSIONS_PATH,
      body: {
        profileFn: 'claude-isg-ticket',
        prompt: 'plan ticket XWEB-2019',
        name: 'XWEB-2019',
        cwd: APP_NEXT,
      },
    });
  });

  it('reports a refusal the same way the launch form does', async () => {
    const { store, api } = rig();
    api.willAnswer(503, { error: 'no_shell' });

    const started = await store.launch({
      profileFn: 'claude-isg',
      prompt: 'go',
      name: 'x',
      cwd: APP_NEXT,
    });

    expect(started).toBeUndefined();
    expect(store.snapshot().error).toContain('powershell.exe');
  });

  it('leaves the launch form’s own call sending no folder', async () => {
    const { store, api } = rig();
    api.willAnswer(201, { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });

    await store.launch({ profileFn: 'claude-365', prompt: 'hello', name: 'name', cwd: '' });

    // `''` is what core reads as "no cwd" (`optionalString`), so the form still starts a session
    // in core's own directory and nothing about it changed.
    expect(api.requests[0]?.body).toEqual({
      profileFn: 'claude-365',
      prompt: 'hello',
      name: 'name',
      cwd: '',
    });
  });
});
