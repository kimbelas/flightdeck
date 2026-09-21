// The headless `stream-json` capture — P4-T4, DECISIONS.md D28.
//
// D28 moved a capture out of P0 and into the task that parses it, on the argument that "a fixture
// captured without a consumer is captured wrong". This is that argument paying off twice.
//
// **The documented vocabulary was incomplete.** RESEARCH.md D.8 lists five record types from the
// published docs: `system/init`, `assistant`, `user`, `stream_event`, `result`. One real run of
// one trivial prompt emitted FOUR more — `system/status`, `system/notification`,
// `system/hook_started`, `system/hook_response` — plus a `rate_limit_event` nobody had written
// down. A parser built to the documentation alone would have met five unknown shapes on its first
// run, which is the case this file exists to have already met.
//
// **The `rate_limit_event` is the find.** It carries both quota windows, which means an Ask run
// reports headroom the same way a statusLine render does — and in DIFFERENT UNITS: `utilization`
// is a fraction here (`0.08`) where `used_percentage` is a percentage there (`8`). Two units for
// one quantity, from one binary, in two payloads. That is exactly what a fixture is for, and
// exactly the kind of thing that would otherwise be found as a gauge reading 0 %.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAskLine, type AskRecord } from '../../contracts/ask-record.ts';

const CAPTURE = join(import.meta.dirname, '..', '..', 'fixtures', 'ask', 'headless-stream.jsonl');

function lines(): readonly string[] {
  return readFileSync(CAPTURE, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

function records(): readonly AskRecord[] {
  return lines()
    .map((line) => parseAskLine(line))
    .filter((record): record is AskRecord => record !== undefined);
}

function kinds(): readonly string[] {
  return records().map((record) => record.kind);
}

describe('the headless stream-json capture', () => {
  it('is one JSON document per line, and every line parses as JSON', () => {
    // JSONL is scrubbed per line and comes back compact precisely so this stays true (P1-T7): in
    // this format the newline IS the record separator, and a pretty-printed capture is a document
    // no line-oriented reader could get back.
    for (const line of lines()) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
  });

  it('carries the four record types the published docs do not list', () => {
    // D.8's list is five. If a future capture loses these, the parser's `default: undefined` is
    // doing nothing and the drops below are untested.
    const raw = lines().map((line) => JSON.parse(line) as { type: string; subtype?: string });
    const seen = new Set(raw.map((one) => `${one.type}/${one.subtype ?? ''}`));

    expect(seen).toContain('system/status');
    expect(seen).toContain('system/notification');
    expect(seen).toContain('system/hook_started');
    expect(seen).toContain('system/hook_response');
    expect(seen).toContain('rate_limit_event/');
  });

  it('drops the four that say nothing a result panel can act on', () => {
    // `hook_started` / `hook_response` are Flightdeck's own hooks firing, and `system/status` is a
    // spinner. Dropped at the parse, so they never cross the wire at all.
    const raw = lines().map((line) => JSON.parse(line) as { type: string; subtype?: string });
    const dropped = raw.filter((one) =>
      ['hook_started', 'hook_response', 'status'].includes(one.subtype ?? ''),
    );

    expect(dropped.length).toBeGreaterThan(0);
    for (const one of dropped) {
      expect(parseAskLine(JSON.stringify(one))).toBeUndefined();
    }
  });
});

describe('what the capture becomes', () => {
  it('opens with `started` and closes with `done`', () => {
    const seen = kinds();

    expect(seen[0]).toBe('started');
    expect(seen.at(-1)).toBe('done');
  });

  it('reports the permission mode the run actually had — which is D47 in one field', () => {
    // The capture was taken through `claude-365`, and every profile function passes
    // `--dangerously-skip-permissions` unconditionally. This is the measurement SEC-PROC-4 is
    // unenforceable against (F.9.3), preserved in a committed file rather than in a sentence.
    const started = records().find((record) => record.kind === 'started');

    expect(started).toBeDefined();
    expect(started?.kind === 'started' ? started.permissionMode : undefined).toBe(
      'bypassPermissions',
    );
  });

  it('converts the rate-limit fractions into the percentages the rest of the deck holds', () => {
    // 0.08 and 0.28 on the wire; 8 and 28 in the contract. The statusLine payload calls the same
    // quantity `used_percentage` and already sends it in percent.
    const quota = records().find((record) => record.kind === 'quota');

    expect(quota).toBeDefined();
    if (quota?.kind !== 'quota') throw new Error('no quota record in the capture');
    expect(quota.quota.fiveHourPercentage).toBe(8);
    expect(quota.quota.sevenDayPercentage).toBe(28);
    // Seconds on the wire, milliseconds here — as statusline-report.ts already does.
    expect(quota.quota.fiveHourResetsAt).toBe(1789977600 * 1000);
  });

  it('recovers the answer text from both the deltas and the complete block', () => {
    const delta = records().find((record) => record.kind === 'delta');
    const text = records().find((record) => record.kind === 'text');

    expect(delta?.kind === 'delta' ? delta.text : '').not.toBe('');
    expect(text?.kind === 'text' ? text.text : '').not.toBe('');
  });

  it('reads the final record as a success with a cost on it', () => {
    const done = records().at(-1);

    if (done?.kind !== 'done') throw new Error('the capture does not end with a result');
    expect(done.ok).toBe(true);
    expect(done.costUsd).toBeGreaterThan(0);
    expect(done.stopReason).toBe('end_turn');
  });
});

describe('what the narrowing keeps OFF the wire — SEC-UI-2, SEC-DATA-2', () => {
  it('relays none of the init record beyond the three fields it names', () => {
    // The real `system/init` carries `messaging_socket_path` (a named pipe D12 says never to
    // touch), `memory_paths`, every plugin `path` — all three containing the Windows account name
    // — plus the tool list and the MCP roster. None of it survives the parse, and the test asserts
    // that by SHAPE rather than by string, so a field added upstream is excluded by default.
    const rawInit = lines()
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((one) => one['subtype'] === 'init');
    const started = records().find((record) => record.kind === 'started');

    expect(rawInit?.['messaging_socket_path']).toBeDefined();
    expect(rawInit?.['memory_paths']).toBeDefined();
    expect(Object.keys(started ?? {}).sort()).toEqual([
      'kind',
      'model',
      'permissionMode',
      'sessionId',
    ]);
  });

  it('puts no Windows path into any record it produces', () => {
    // The blunt version of the check above, over every record in the capture: a drive letter in
    // anything the deck draws is the SEC-DATA-2 failure, whichever field carried it.
    const serialised = JSON.stringify(records());

    expect(serialised).not.toMatch(/[A-Za-z]:\\\\/);
    expect(serialised).not.toContain('\\\\.\\pipe');
  });
});
