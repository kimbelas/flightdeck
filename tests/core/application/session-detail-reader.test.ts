// `SessionDetailReader` — the join, and what it refuses to carry (P2-T4).
//
// Three producers, one shape. What is worth testing is not that the fields copy across but the
// three decisions around them: that a missing producer is an ordinary answer rather than a failure,
// that the path is screened before it is opened, and that the transcript path never leaves core.
import { describe, expect, it } from 'vitest';
import {
  SessionDetailReader,
  type DigestSource,
} from '../../../core/application/session-detail-reader.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import { TranscriptDigest } from '../../../core/domain/transcript-digest.ts';
import type { StatuslineReport } from '../../../contracts/statusline-report.ts';
import type { SessionRef } from '../../../contracts/session-ref.ts';
import type { Clock } from '../../../core/ports/clock.ts';
import type { JobFiles } from '../../../core/ports/job-files.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

const NOW = 1_789_000_100_000;
const CFG_365 = 'C:\\Users\\someone\\.claude-365';
const CFG_ISG = 'C:\\Users\\someone\\.claude-isg';
const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';

const REF: SessionRef = { sessionId: SESSION, shortId: 'cb5e8102', subscription: '365' };

const STATE = JSON.stringify({
  state: 'blocked',
  detail: 'waiting for a repo',
  needs: 'navigate to a git repository or initialize one with git init',
  tokens: 454,
  intent: 'show me the last five commits',
  updatedAt: '2026-09-14T12:00:00.000Z',
});

const TIMELINE = [
  JSON.stringify({ at: '2026-09-14T11:59:00.000Z', state: 'working', detail: 'looking', text: '' }),
  JSON.stringify({
    at: '2026-09-14T12:00:00.000Z',
    state: 'blocked',
    detail: 'stuck',
    text: 'The command failed.',
  }),
].join('\n');

/** Records which paths were asked for, so the screening can be asserted from outside. */
class FakeJobFiles implements JobFiles {
  public readonly asked: string[] = [];
  private readonly contents: Readonly<Record<string, string>>;

  constructor(contents: Readonly<Record<string, string>> = {}) {
    this.contents = contents;
  }

  public read(path: string): Promise<string | undefined> {
    this.asked.push(path);
    const name = path.split('\\').at(-1) ?? '';
    return Promise.resolve(this.contents[name]);
  }
}

class FixedClock implements Clock {
  public now(): Date {
    return new Date(NOW);
  }
}

function report(overrides: Partial<StatuslineReport> = {}): StatuslineReport {
  return {
    sessionId: SESSION,
    transcriptPath: 'C:\\Users\\someone\\.claude-365\\projects\\secret-project\\t.jsonl',
    sessionName: 'the-one',
    modelId: 'claude-opus-5',
    modelName: 'Opus 5',
    claudeVersion: '2.1.270',
    costUsd: 1.25,
    usedPercentage: 42,
    contextWindowSize: 200_000,
    fiveHour: { usedPercentage: 23, resetsAt: NOW + 1000 },
    sevenDay: { usedPercentage: 61, resetsAt: NOW + 2000 },
    ...overrides,
  };
}

function digestSource(digest: TranscriptDigest | undefined): DigestSource {
  return { get: () => (digest === undefined ? undefined : { digest }) };
}

interface Rig {
  readonly reader: SessionDetailReader;
  readonly files: FakeJobFiles;
  readonly logger: FakeLogger;
}

function rig(
  options: {
    readonly contents?: Readonly<Record<string, string>>;
    readonly vitals?: StatuslineReport;
    readonly digest?: TranscriptDigest;
  } = {},
): Rig {
  const files = new FakeJobFiles(options.contents ?? {});
  const logger = new FakeLogger();
  const registry = new VitalsRegistry();
  if (options.vitals !== undefined) registry.record(options.vitals, '365', NOW - 2000);
  const reader = new SessionDetailReader({
    vitals: registry,
    transcripts: digestSource(options.digest),
    files,
    policy: new ReadPolicy([CFG_365, CFG_ISG]),
    configDirs: { '365': CFG_365, isg: CFG_ISG },
    clock: new FixedClock(),
    logger,
  });
  return { reader, files, logger };
}

describe('SessionDetailReader', () => {
  it('reads both job files from the right subscription`s config directory', async () => {
    const { reader, files } = rig();

    await reader.read(REF);

    expect(files.asked).toEqual([
      `${CFG_365}\\jobs\\cb5e8102\\state.json`,
      `${CFG_365}\\jobs\\cb5e8102\\timeline.jsonl`,
    ]);
  });

  it('reads the other subscription`s directory for the other subscription', async () => {
    const { reader, files } = rig();

    await reader.read({ ...REF, subscription: 'isg' });

    expect(files.asked[0]).toBe(`${CFG_ISG}\\jobs\\cb5e8102\\state.json`);
  });

  it('carries the attention text, which is what the whole route is for', async () => {
    const { reader } = rig({ contents: { 'state.json': STATE, 'timeline.jsonl': TIMELINE } });

    const detail = await reader.read(REF);

    expect(detail.job?.needs).toBe('navigate to a git repository or initialize one with git init');
    expect(detail.job?.state).toBe('blocked');
    expect(detail.timeline).toHaveLength(2);
    expect(detail.timeline[1]?.text).toBe('The command failed.');
  });

  it('answers with an empty detail rather than nothing when a session has no job directory', async () => {
    // An interactive session has none at all (F.7.1). "Nothing to show" and "could not be read"
    // are different things, and the deck draws them differently.
    const { reader } = rig();

    const detail = await reader.read(REF);

    expect(detail.sessionId).toBe(SESSION);
    expect(detail.job).toBeUndefined();
    expect(detail.timeline).toEqual([]);
    expect(detail.at).toBe(NOW);
  });

  it('survives a state file caught mid-write', async () => {
    const { reader } = rig({ contents: { 'state.json': '{"state":"bloc' } });

    await expect(reader.read(REF)).resolves.toMatchObject({ job: undefined });
  });

  it('joins the vitals for this session', async () => {
    const { reader } = rig({ vitals: report() });

    const detail = await reader.read(REF);

    expect(detail.vitals?.usedPercentage).toBe(42);
    expect(detail.vitals?.modelName).toBe('Opus 5');
    expect(detail.vitals?.contextWindowSize).toBe(200_000);
  });

  it('never carries the transcript path, from any of the three sources', async () => {
    // SEC-DATA-2. It is in the registry's report and it is the field that names the account and
    // the project folder; `core-status.ts` keeps it off the status screen for the same reason.
    const { reader } = rig({
      vitals: report(),
      contents: { 'state.json': STATE },
      digest: TranscriptDigest.EMPTY.with({ kind: 'file', path: 'C:\\work\\a.ts', at: NOW }),
    });

    const detail = await reader.read(REF);

    expect(JSON.stringify(detail)).not.toContain('secret-project');
    expect(JSON.stringify(detail)).not.toContain('transcriptPath');
  });

  it('flattens feed 4`s digest, including the sparkline', async () => {
    const digest = TranscriptDigest.EMPTY.with({
      kind: 'title',
      title: 'the-one',
      custom: true,
    }).with({ kind: 'file', path: 'C:\\work\\a.ts', at: NOW });

    const { reader } = rig({ digest });

    const detail = await reader.read(REF);

    expect(detail.extras.title).toBe('the-one');
    expect(detail.extras.titleIsCustom).toBe(true);
    expect(detail.extras.files).toEqual(['C:\\work\\a.ts']);
    // Below two points, so no line — `TranscriptDigest.tokenTrail` refuses to hand back a dot.
    expect(detail.tokenTrail).toEqual([]);
  });

  it('gives empty extras rather than refusing when feed 4 has read nothing', async () => {
    const { reader } = rig({ digest: TranscriptDigest.EMPTY });

    const detail = await reader.read(REF);

    expect(detail.extras.files).toEqual([]);
    expect(detail.extras.title).toBeUndefined();
  });
});
