// The three preset routes — P4-T1.
//
// Each is tested against a one-method double rather than a real `PresetBook`, which is what the
// narrow ports on those routes exist for: whether a cwd is inside a project is settled in
// `preset-book.test.ts`, and what is settled here is the status, the shape and the two refusals a
// route can produce on its own.
import { describe, expect, it } from 'vitest';
import type { LaunchPreset, PresetDraft, PresetRef } from '../../../contracts/launch-preset.ts';
import {
  ForgetPresetRoute,
  PresetsRoute,
  SavePresetRoute,
} from '../../../core/http/presets-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';

const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;

const PRESET: LaunchPreset = {
  projectKey: APP_NEXT.toLowerCase(),
  id: 'ticket',
  name: 'ticket',
  profileFn: 'claude-isg-ticket',
  cwd: APP_NEXT,
  sessionName: 'XWEB-2019',
  promptSource: 'ticket',
  prompt: '',
  group: undefined,
  agent: undefined,
  builtIn: true,
};

/** The routes never read the facts — CoreServer has screened the request (LaunchRoute's note). */
const FACTS = {} as unknown as RequestFacts;

const DRAFT = JSON.stringify({
  projectPath: APP_NEXT,
  name: 'ticket',
  profileFn: 'claude-isg-ticket',
  cwd: '',
  sessionName: 'XWEB-2019',
  promptSource: 'ticket',
  prompt: '',
  group: undefined,
  agent: undefined,
});

describe('PresetsRoute', () => {
  it('is a GET on its own literal path, spending the control budget', () => {
    const route = new PresetsRoute({ list: () => [] });

    expect([route.method, route.path, route.limit, route.credential]).toEqual([
      'GET',
      '/projects/presets',
      'control',
      'token',
    ]);
  });

  it('wraps the list in an object rather than answering a bare array', () => {
    // A top-level JSON array is a shape that cannot grow a field, and every other route here
    // answers with an object.
    const route = new PresetsRoute({ list: () => [PRESET] });

    expect(route.handle()).toEqual({ status: 200, body: { presets: [PRESET] } });
  });

  it('answers an empty list on a machine that has imported nothing', () => {
    expect(new PresetsRoute({ list: () => [] }).handle().body).toEqual({ presets: [] });
  });
});

describe('SavePresetRoute', () => {
  function route(answer: Result<LaunchPreset, 'bad_cwd'>): {
    route: SavePresetRoute;
    seen: PresetDraft[];
  } {
    const seen: PresetDraft[] = [];
    return {
      route: new SavePresetRoute({
        save: (draft) => {
          seen.push(draft);
          return Promise.resolve(answer);
        },
      }),
      seen,
    };
  }

  it('is a POST on the same path as the GET — two rows in the table, not one handler', () => {
    const { route: saver } = route(ok(PRESET));

    expect([saver.method, saver.path]).toEqual(['POST', '/projects/presets']);
  });

  it('answers 201 with the stored preset', async () => {
    const { route: saver, seen } = route(ok(PRESET));

    const reply = await saver.handle(FACTS, DRAFT);

    expect(reply).toEqual({ status: 201, body: { preset: PRESET } });
    expect(seen[0]?.name).toBe('ticket');
  });

  it('answers 400 with the refusal code, never a sentence', async () => {
    const { route: saver } = route(err('bad_cwd'));

    expect(await saver.handle(FACTS, DRAFT)).toEqual({ status: 400, body: { error: 'bad_cwd' } });
  });

  it('refuses a body that is not a draft before the book is asked', async () => {
    const { route: saver, seen } = route(ok(PRESET));

    const reply = await saver.handle(FACTS, '{"projectPath":""}');

    expect(reply).toEqual({ status: 400, body: { error: 'empty' } });
    expect(seen).toEqual([]);
  });

  it('refuses a profile function this build does not allowlist', async () => {
    const { route: saver, seen } = route(ok(PRESET));

    const reply = await saver.handle(
      FACTS,
      DRAFT.replace('claude-isg-ticket', 'claude-isg-agents'),
    );

    // SEC-PROC-2: the allowlist is the parser's, so nothing unlisted reaches an argv builder.
    expect(reply.status).toBe(400);
    expect(seen).toEqual([]);
  });
});

describe('ForgetPresetRoute', () => {
  function route(removed: boolean): { route: ForgetPresetRoute; seen: PresetRef[] } {
    const seen: PresetRef[] = [];
    return {
      route: new ForgetPresetRoute({
        forget: (ref) => {
          seen.push(ref);
          return removed;
        },
      }),
      seen,
    };
  }

  it('is a POST at its own literal path — the router has no DELETE to reach for', () => {
    expect(route(true).route.path).toBe('/projects/presets/forget');
    expect(route(true).route.method).toBe('POST');
  });

  it('answers 200 with whether a row was removed, not a 404', () => {
    // The request asked for a state and that state holds either way; "removed" and "that one is
    // built in" are different sentences, which is what the boolean is for.
    const body = JSON.stringify({ projectPath: APP_NEXT, id: 'ticket' });

    expect(route(true).route.handle(FACTS, body)).toEqual({
      status: 200,
      body: { forgotten: true },
    });
    expect(route(false).route.handle(FACTS, body)).toEqual({
      status: 200,
      body: { forgotten: false },
    });
  });

  it('refuses a ref missing either half before the book is asked', () => {
    const { route: forgetter, seen } = route(true);

    const reply = forgetter.handle(FACTS, JSON.stringify({ id: 'ticket' }));

    expect(reply).toEqual({ status: 400, body: { error: 'empty' } });
    expect(seen).toEqual([]);
  });
});
