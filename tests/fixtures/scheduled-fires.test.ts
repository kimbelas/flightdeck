// The `scheduled_task_fire` fixture — P7-T4, SPEC §6(11).
//
// Three real fires, scrubbed: one of the older shape (2.1.234: `cronKind` only, no task id, no
// cron) and two consecutive `/loop` wake-ups of one newer session (2.1.280), which is where the
// finding lives — each wake-up carries a NEW task id and a one-shot cron for the minute it chose.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTranscriptRecord } from '../../contracts/transcript-record.ts';
import { ObservedTally } from '../../core/domain/observed-tally.ts';

const RECORDS: readonly Record<string, unknown>[] = readFileSync(
  new URL('../../fixtures/transcript/scheduled-fires.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
  });

describe('the captured scheduled fires', () => {
  it('are two shapes: the older one names only cronKind, the newer adds a task id and a cron', () => {
    expect(RECORDS.map((record) => [record['taskId'] !== undefined, record['cronKind']])).toEqual([
      [false, 'loop'],
      [true, 'loop'],
      [true, 'loop'],
    ]);
  });

  it('give each /loop wake-up its own task id — which is why the tally is per kind', () => {
    const ids = RECORDS.flatMap((record) => (typeof record['taskId'] === 'string' ? [record['taskId']] : []));
    expect(new Set(ids).size).toBe(2);
    expect(new Set(RECORDS.map((record) => record['sessionId'])).size).toBe(2);
  });

  it('scrubbed the prompt and the content, and kept the schedule readable', () => {
    for (const record of RECORDS) {
      expect(record['content']).toMatch(/^text-[0-9a-f]{8}$/u);
      if (record['prompt'] !== undefined) expect(record['prompt']).toMatch(/^text-[0-9a-f]{8}$/u);
      if (record['cron'] !== undefined) expect(record['cron']).toMatch(/^\d+ \d+ \* \* \*$/u);
    }
  });

  it('parse to records that carry the kind and the cron and never the prompt', () => {
    const parsed = RECORDS.map((record) => parseTranscriptRecord(record));

    expect(parsed.map((record) => record?.kind)).toEqual(['scheduled', 'scheduled', 'scheduled']);
    expect(parsed[0]).toMatchObject({ taskKind: 'loop', cron: undefined });
    expect(parsed[1]).toMatchObject({ taskKind: 'loop', cron: '56 9 * * *' });
    expect(JSON.stringify(parsed)).not.toContain('text-');
  });

  it('fold into one loop entry across both sessions', () => {
    const tally = new ObservedTally();
    for (const record of RECORDS) {
      const parsed = parseTranscriptRecord(record);
      tally.addSession('isg', parsed === undefined ? [] : [parsed], 0);
    }

    const [loop] = tally.summarise('C:/p', Date.now(), 0).schedules;
    expect(loop).toMatchObject({ kind: 'loop', fires: 3, sessions: 3, lastCron: '27 10 * * *' });
  });
});
