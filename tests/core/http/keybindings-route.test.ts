// `GET /keybindings` and `POST /keybindings` — P5a-T7.
//
// The headers are CoreServer's and are tested there. What is these routes' own is that the GET
// cannot write, the POST takes nothing from the page but a direction, and a refusal is a 409
// rather than a 500.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { KEYBINDINGS_FILE, KeybindingHelper } from '../../../core/application/keybinding-helper.ts';
import { KeybindingPlanRoute, KeybindingWriteRoute } from '../../../core/http/keybindings-route.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeConfigFile } from '../../fakes/fake-config-file.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

const HOME = String.raw`C:\home`;

function routes(initial: Readonly<Record<string, string>> = {}): {
  plan: KeybindingPlanRoute;
  write: KeybindingWriteRoute;
  files: FakeConfigFile;
} {
  const files = new FakeConfigFile(initial);
  const helper = new KeybindingHelper({
    install: new ClaudeInstall(HOME, ''),
    files,
    logger: new FakeLogger(),
  });
  return { plan: new KeybindingPlanRoute(helper), write: new KeybindingWriteRoute(helper), files };
}

function get(url: string): RequestFacts {
  return { method: 'GET', url, headers: {} };
}

const POST: RequestFacts = { method: 'POST', url: '/keybindings', headers: {} };

describe('KeybindingPlanRoute', () => {
  it('answers the plan and writes nothing', () => {
    const { plan, files } = routes();
    const answer = plan.handle(get('/keybindings?direction=apply'));

    expect(answer.status).toBe(200);
    expect(files.operations).toEqual([]);
  });

  it('defaults to apply, which is what the sheet asks for', () => {
    const { plan } = routes();
    expect(plan.handle(get('/keybindings')).body).toMatchObject({ direction: 'apply' });
  });

  it('refuses a direction it does not know rather than guessing one', () => {
    const { plan } = routes();
    for (const url of ['/keybindings?direction=wipe', '/keybindings?direction=APPLY']) {
      expect(plan.handle(get(url)).status, url).toBe(400);
    }
  });

  it('spends the control budget and needs the token', () => {
    const { plan, write } = routes();
    for (const route of [plan, write]) {
      expect(route.limit).toBe('control');
      expect(route.credential).toBe('token');
      expect(route.path).toBe('/keybindings');
    }
  });
});

describe('KeybindingWriteRoute', () => {
  it('writes both files and answers with the backups', () => {
    const { write, files } = routes();
    const answer = write.handle(POST, JSON.stringify({ direction: 'apply' }));

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ backups: [] });
    expect(files.operations).toHaveLength(2);
  });

  it('takes nothing from the body but the direction', () => {
    const { write, files } = routes();
    const answer = write.handle(
      POST,
      JSON.stringify({
        direction: 'apply',
        path: String.raw`C:\Windows\System32\drivers\etc\hosts`,
        contents: 'pwned',
      }),
    );

    expect(answer.status).toBe(200);
    for (const operation of files.operations) {
      expect(operation).toContain(KEYBINDINGS_FILE);
      expect(operation).toContain(join(HOME, '.claude-'));
    }
  });

  it('refuses a body with no usable direction', () => {
    const { write, files } = routes();
    for (const body of ['', 'null', '[]', '{}', '{"direction":"wipe"}', '{"direction":true}']) {
      expect(write.handle(POST, body).status, body).toBe(400);
    }
    expect(files.operations).toEqual([]);
  });

  it('answers 409 with the reason when a file cannot be rewritten', () => {
    const { write, files } = routes({
      [join(HOME, '.claude-isg', KEYBINDINGS_FILE)]: '{ not json',
    });
    const answer = write.handle(POST, JSON.stringify({ direction: 'apply' }));

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: 'refused' });
    expect(files.operations).toEqual([]);
  });
});
