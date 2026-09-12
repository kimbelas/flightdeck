// The plan is what the owner sees before a byte is written (D13), so the refusals matter as much
// as the changes — and F.3.7's "refuses rather than guesses" is the branch with the sharpest edge.
import { describe, expect, it } from 'vitest';
import { ConnectPlanner } from '../../../core/application/connect-planner.ts';
import { FakeSessionEnvironment } from '../../fakes/fake-session-environment.ts';
import { FakeSourcePatcher } from '../../fakes/fake-source-patcher.ts';

const SETTINGS = '{\n  "model": "opus"\n}\n';
const STATUSLINE = 'def main():\n    pass\n';

function build(overrides: Record<string, unknown> = {}): ConnectPlanner {
  return new ConnectPlanner({
    settings: [{ subscription: '365', path: 'C:\\cfg\\settings.json', contents: SETTINGS }],
    statusline: { path: 'C:\\hooks\\statusline.py', contents: STATUSLINE },
    patcher: new FakeSourcePatcher(),
    environment: new FakeSessionEnvironment(),
    ...overrides,
  });
}

/** Narrowed through the discriminant, so a refused plan cannot be read as a successful one. */
function changesOf(planner: ConnectPlanner): readonly { path: string; after: string }[] {
  const plan = planner.connect();
  if (!plan.ok) throw new Error(`expected a plan, got refusals: ${JSON.stringify(plan.refusals)}`);
  return plan.changes;
}

describe('ConnectPlanner', () => {
  it('plans one change per file and writes nothing', () => {
    const changes = changesOf(build());

    expect(changes.map((c) => c.path)).toEqual([
      'C:\\cfg\\settings.json',
      'C:\\hooks\\statusline.py',
    ]);
  });

  it('carries whole contents on both sides, so the diff cannot be a summary', () => {
    const plan = build().connect();
    if (!plan.ok) throw new Error('expected a plan');

    for (const change of plan.changes) {
      expect(change.before.length).toBeGreaterThan(0);
      expect(change.after).not.toBe(change.before);
    }
  });

  it('preserves the settings file\u2019s own line endings (RESEARCH.md G.13)', () => {
    const crlf = '{\r\n  "model": "opus"\r\n}\r\n';
    const changes = changesOf(
      build({
        settings: [{ subscription: 'isg', path: 'C:\\isg\\settings.json', contents: crlf }],
      }),
    );

    const settings = changes[0]?.after ?? '';
    expect(settings).toContain('\r\n');
    expect(
      settings.split('\n').every((line, i, all) => i === all.length - 1 || line.endsWith('\r')),
    ).toBe(true);
  });

  it('refuses the whole plan when a settings.json is not valid JSON', () => {
    const plan = build({
      settings: [{ subscription: '365', path: 'C:\\cfg\\settings.json', contents: '{ oops' }],
    }).connect();

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusals[0]?.reason).toBe('not a JSON object');
  });

  it('refuses a settings.json that parses but is not an object', () => {
    const plan = build({
      settings: [{ subscription: '365', path: 'C:\\cfg\\settings.json', contents: '[1,2]' }],
    }).connect();

    expect(plan.ok).toBe(false);
  });

  it('refuses when the file is missing rather than creating one', () => {
    const plan = build({
      settings: [{ subscription: '365', path: 'C:\\cfg\\settings.json', contents: undefined }],
    }).connect();

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusals[0]?.reason).toContain('does not exist');
  });

  it('refuses, naming the anchor, when the statusline patcher will not guess (F.3.7)', () => {
    const patcher = new FakeSourcePatcher();
    patcher.refuseWith = 'anchor "def main():" matched 0 lines';

    const plan = build({ patcher }).connect();

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusals[0]?.reason).toContain('matched 0 lines');
  });

  it('one refusal fails the whole plan, so nothing is applied by halves', () => {
    const plan = build({
      settings: [
        { subscription: '365', path: 'C:\\a\\settings.json', contents: SETTINGS },
        { subscription: 'isg', path: 'C:\\b\\settings.json', contents: 'nope' },
      ],
    }).connect();

    expect(plan.ok).toBe(false);
  });

  it('reports an already-connected file as unchanged rather than as an error', () => {
    const connected = changesOf(build())[0]?.after ?? '';
    const plan = build({
      settings: [{ subscription: '365', path: 'C:\\cfg\\settings.json', contents: connected }],
    }).connect();

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.alreadyDone.some((label) => label.includes('already connected'))).toBe(true);
  });

  it('disconnect is the inverse: it plans changes only where Connect had been applied', () => {
    const planner = build();
    const connected = changesOf(planner)[0]?.after ?? '';

    const fresh = build().disconnect();
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.changes).toHaveLength(0);

    const applied = build({
      settings: [{ subscription: '365', path: 'C:\\cfg\\settings.json', contents: connected }],
    }).disconnect();
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.changes.map((c) => c.path)).toContain('C:\\cfg\\settings.json');
  });

  it('plans to publish the env var when it is not set, and to withdraw it on disconnect', () => {
    const environment = new FakeSessionEnvironment();

    const connect = build({ environment }).connect();
    expect(connect.ok && connect.environment).toBe('publish');

    environment.published = true;
    const disconnect = build({ environment }).disconnect();
    expect(disconnect.ok && disconnect.environment).toBe('withdraw');
  });

  it('asks for no env change when it is already right', () => {
    const environment = new FakeSessionEnvironment();
    environment.published = true;

    const plan = build({ environment }).connect();

    expect(plan.ok && plan.environment).toBe('none');
  });
});
