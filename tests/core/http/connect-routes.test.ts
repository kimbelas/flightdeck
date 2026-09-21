// `GET /connect` and `POST /connect` — P4-T6.
//
// The headers are CoreServer's and are tested there; the planner's own rules are tested in
// `connect-planner.test.ts`. What is these two routes' own is that the GET cannot write, that the
// POST takes nothing from the page but a direction, that a refusal is a 409 carrying the backups
// already taken, and that both writes leave an audit row.
import { describe, expect, it } from 'vitest';
import { parseConnectPlanReply, type FileChange } from '../../../contracts/connect-plan.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { Connector } from '../../../core/application/connector.ts';
import { ConnectPlanRoute, ConnectWriteRoute } from '../../../core/http/connect-routes.ts';
import type { RequestFacts } from '../../../core/http/loopback-guard.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeConfigFile } from '../../fakes/fake-config-file.ts';
import { FakeCoreHealth } from '../../fakes/fake-core-health.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeSessionEnvironment } from '../../fakes/fake-session-environment.ts';
import { FakeSourcePatcher } from '../../fakes/fake-source-patcher.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const SETTINGS_365 = String.raw`C:\cfg\.claude-365\settings.json`;
const SETTINGS_ISG = String.raw`C:\cfg\.claude-isg\settings.json`;
const STATUSLINE = String.raw`C:\cfg\.claude\hooks\statusline.py`;

/** A machine where nothing is connected: both settings readable, statusline.py unpatched. */
const FRESH: Readonly<Record<string, string>> = {
  [SETTINGS_365]: '{\n  "model": "opus"\n}\n',
  [SETTINGS_ISG]: '{\n  "model": "sonnet"\n}\n',
  [STATUSLINE]: 'def main():\n    pass\n',
};

interface Harness {
  readonly plan: ConnectPlanRoute;
  readonly write: ConnectWriteRoute;
  readonly files: FakeConfigFile;
  readonly store: FakeStore;
  readonly environment: FakeSessionEnvironment;
  readonly patcher: FakeSourcePatcher;
  readonly health: FakeCoreHealth;
}

function harness(initial: Readonly<Record<string, string>> = FRESH): Harness {
  const files = new FakeConfigFile(initial);
  const patcher = new FakeSourcePatcher();
  const environment = new FakeSessionEnvironment();
  const health = new FakeCoreHealth();
  const store = new FakeStore();
  const connector = new Connector({
    files,
    health,
    patcher,
    environment,
    settingsPaths: [
      { subscription: '365', path: SETTINGS_365 },
      { subscription: 'isg', path: SETTINGS_ISG },
    ],
    statuslinePath: STATUSLINE,
    logger: new FakeLogger(),
  });
  const audit = new AuditLog(store, new FakeClock(), new FakeLogger());
  return {
    plan: new ConnectPlanRoute(connector),
    write: new ConnectWriteRoute(connector, audit),
    files,
    store,
    environment,
    patcher,
    health,
  };
}

function get(url: string): RequestFacts {
  return { method: 'GET', url, headers: {} };
}

const POST: RequestFacts = { method: 'POST', url: '/connect', headers: {} };

describe('ConnectPlanRoute', () => {
  it('answers a whole plan and writes nothing', () => {
    const { plan, files } = harness();
    const answer = plan.handle(get('/connect?direction=connect'));

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ direction: 'connect', plan: { ok: true } });
    expect(files.operations).toEqual([]);
  });

  it('carries the before and after of every file, so the diff is the deck to render', () => {
    const { plan } = harness();
    const body = plan.handle(get('/connect?direction=connect')).body;
    const changes = readChanges(body);

    expect(changes.map((change) => change.path)).toEqual([SETTINGS_365, SETTINGS_ISG, STATUSLINE]);
    for (const change of changes) {
      expect(change.before, change.path).toBe(FRESH[change.path]);
      expect(change.after, change.path).not.toBe(change.before);
    }
  });

  it('defaults to connect, which is what a panel opening for the first time asks', () => {
    const { plan } = harness();
    // Both forms of ABSENT: no query at all, and a query carrying something else.
    for (const url of ['/connect', '/connect?x=1']) {
      expect(plan.handle(get(url)).body, url).toMatchObject({ direction: 'connect' });
    }
  });

  it('refuses a direction it does not recognise rather than falling back to one', () => {
    const { plan } = harness();
    // `CONNECT` is here because the keybindings route shipped with a capture narrow enough that an
    // unrecognised value matched nothing and became the DEFAULT instead of a 400.
    for (const url of [
      '/connect?direction=wipe',
      '/connect?direction=CONNECT',
      '/connect?direction=',
    ]) {
      expect(plan.handle(get(url)).status, url).toBe(400);
    }
  });

  it('reports a refusal as a plan that is not ok, never as an error status', () => {
    const { plan, patcher } = harness();
    patcher.refuseWith = 'the def main(): anchor has moved';

    const answer = plan.handle(get('/connect?direction=connect'));
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      plan: { ok: false, refusals: [{ path: STATUSLINE, reason: patcher.refuseWith }] },
    });
  });

  it('spends the control budget, needs the token, and shares one path with the write', () => {
    const { plan, write } = harness();
    for (const route of [plan, write]) {
      expect(route.limit).toBe('control');
      expect(route.credential).toBe('token');
      expect(route.path).toBe('/connect');
    }
  });
});

describe('ConnectWriteRoute', () => {
  it('writes every file, backing each up first, and answers with the backups', async () => {
    const { write, files, store } = harness();
    const answer = await write.handle(POST, JSON.stringify({ direction: 'connect' }));

    expect(answer.status).toBe(200);
    expect(files.operations).toEqual([
      `backup ${SETTINGS_365}`,
      `write ${SETTINGS_365}`,
      `backup ${SETTINGS_ISG}`,
      `write ${SETTINGS_ISG}`,
      `backup ${STATUSLINE}`,
      `write ${STATUSLINE}`,
    ]);
    expect(answer.body).toMatchObject({
      direction: 'connect',
      applied: [
        { path: SETTINGS_365, backup: `${SETTINGS_365}.bak-fake` },
        { path: SETTINGS_ISG, backup: `${SETTINGS_ISG}.bak-fake` },
        { path: STATUSLINE, backup: `${STATUSLINE}.bak-fake` },
      ],
      environment: 'publish',
    });
    expect(store.allAudit.map((row) => [row.action, row.outcome])).toEqual([
      ['flightdeck_connect', 'ok'],
    ]);
  });

  it('publishes the ingest key alongside the files, because half of it is the 401 (F.1.6)', async () => {
    const { write, environment } = harness();
    await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    expect(environment.calls).toEqual(['publish']);
  });

  it('re-plans from disk, so a page that asks twice cannot write twice', async () => {
    const { write, files } = harness();
    await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    files.operations.length = 0;

    const second = await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ applied: [] });
    expect(files.operations).toEqual([]);
  });

  it('takes nothing from the body but the direction', async () => {
    const { write, files } = harness();
    const body = JSON.stringify({
      direction: 'connect',
      path: String.raw`C:\Windows\System32\drivers\etc\hosts`,
      after: 'owned',
      changes: [{ path: 'anything', before: '', after: 'owned' }],
    });
    await write.handle(POST, body);

    expect([...files.files.keys()]).toEqual([SETTINGS_365, SETTINGS_ISG, STATUSLINE]);
    expect([...files.files.values()].some((text) => text.includes('owned'))).toBe(false);
  });

  it('refuses a body that is not one of the two directions', async () => {
    const { write, files } = harness();
    for (const body of ['{}', '{"direction":"wipe"}', 'not json', '[]']) {
      expect((await write.handle(POST, body)).status, body).toBe(400);
    }
    expect(files.operations).toEqual([]);
  });

  it('refuses a plan the planner would not make, and audits the refusal', async () => {
    const { write, patcher, files, store } = harness();
    patcher.refuseWith = 'the def main(): anchor has moved';

    const answer = await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: 'refused', applied: [] });
    expect(files.operations).toEqual([]);
    expect(store.auditFailures().map((row) => row.action)).toEqual(['flightdeck_connect']);
  });

  it('refuses to connect against a core that is not answering (F.1.5)', async () => {
    const { write, health, files } = harness();
    health.running = false;

    const answer = await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: 'core is not running' });
    expect(files.operations).toEqual([]);
  });

  it('disconnects without asking whether core is running — that is why somebody runs it', async () => {
    const { write, health, files } = harness();
    await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    health.running = false;
    files.operations.length = 0;

    const answer = await write.handle(POST, JSON.stringify({ direction: 'disconnect' }));
    expect(answer.status).toBe(200);
    expect(files.operations).toContain(`backup ${SETTINGS_365}`);
  });

  it('names the backups it had already taken when a write fails part way through', async () => {
    const { write, files, store } = harness();
    files.failOn = SETTINGS_ISG;

    const answer = await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({
      applied: [{ path: SETTINGS_365, backup: `${SETTINGS_365}.bak-fake` }],
    });
    expect(store.auditFailures()[0]?.args).toEqual([SETTINGS_365]);
  });

  it('puts every byte back — disconnect after connect restores the originals', async () => {
    const { write, files } = harness();
    await write.handle(POST, JSON.stringify({ direction: 'connect' }));
    await write.handle(POST, JSON.stringify({ direction: 'disconnect' }));

    for (const [path, contents] of Object.entries(FRESH)) {
      expect(files.files.get(path), path).toBe(contents);
    }
  });
});

/**
 * The plan's changes, read through the deck's OWN parser.
 *
 * Not a cast: a body this test could read but `parseConnectPlanReply` could not is a body the
 * panel would render as "core answered 200" and nothing else, which is a bug this file should be
 * able to fail on.
 */
function readChanges(body: unknown): readonly FileChange[] {
  const plan = parseConnectPlanReply(body);
  expect(plan?.ok).toBe(true);
  return plan?.ok === true ? plan.changes : [];
}
