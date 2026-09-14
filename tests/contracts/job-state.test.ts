// `state.json` and `timeline.jsonl`, as parsers — P2-T4, RESEARCH.md F.2.4 and F.2.14.
//
// Two things are being pinned. The projection: 25 keys go in and nine come out, and the ones left
// behind include the two that name the owner's machine. And the caps: every string here except
// `intent` is model-generated and `text` is the full assistant message with no documented bound
// (SEC-UI-2), so a release where the model got chatty must cost a recap its tail and nothing else.
import { describe, expect, it } from 'vitest';
import {
  MAX_DETAIL_CHARS,
  MAX_TEXT_CHARS,
  MAX_TIMELINE_ENTRIES,
  parseJobState,
  parseTimeline,
} from '../../contracts/job-state.ts';
import stateFixture from '../../fixtures/jobs/state.json' with { type: 'json' };
import blockedFixture from '../../fixtures/jobs/state-blocked.json' with { type: 'json' };
import timelineFixture from '../../fixtures/jobs/timeline.json' with { type: 'json' };

describe('parseJobState', () => {
  it('reads a real resting state file', () => {
    const job = parseJobState(stateFixture.state_file);

    expect(job?.state).toBe('done');
    expect(job?.tempo).toBe('idle');
    expect(job?.tokens).toBe(48);
    expect(job?.inFlightTasks).toBe(0);
    expect(job?.result).toBe('text-0dfe1f65');
    expect(job?.updatedAt).toBe(Date.parse('2020-09-11T19:32:56.844Z'));
  });

  it('reads the `needs` sentence, which is the whole reason this file is opened', () => {
    // A model-written sentence saying what the session wants from the owner. It exists only while
    // blocked (F.2.4), and it is the answer to "what needs me?" without opening a transcript.
    const job = parseJobState(blockedFixture.state_file);

    expect(job?.state).toBe('blocked');
    expect(job?.needs).toBe('text-65b0167b');
  });

  it('has no `needs` when the session is not blocked', () => {
    expect(parseJobState(stateFixture.state_file)?.needs).toBeUndefined();
  });

  it('survives `output: null`, which a blocked session really writes', () => {
    // Not a hypothetical: `state-blocked.json` carries `"output": null`, and a parser that reached
    // into it without checking would throw on the one state this screen exists for.
    expect(() => parseJobState(blockedFixture.state_file)).not.toThrow();
    expect(parseJobState(blockedFixture.state_file)?.result).toBeUndefined();
  });

  it('leaves behind the two fields that name the machine', () => {
    // `linkScanPath` is a transcript under the owner's home directory and `providerEnv` names the
    // config dir. Both are in the file, neither is read (SEC-DATA-2).
    const job = parseJobState(stateFixture.state_file);

    expect(JSON.stringify(job)).not.toContain('path-03206b');
    expect(Object.keys(job ?? {})).not.toContain('linkScanPath');
    expect(Object.keys(job ?? {})).not.toContain('providerEnv');
    expect(Object.keys(job ?? {})).not.toContain('cwd');
  });

  it('caps a model-written sentence rather than dropping it', () => {
    // The opposite of TranscriptTail's rule for an oversize line, and deliberately: the JSON is
    // already parsed here, so half a sentence is most of a sentence rather than a parse failure.
    const job = parseJobState({ needs: 'x'.repeat(MAX_DETAIL_CHARS + 50) });

    expect(job?.needs).toHaveLength(MAX_DETAIL_CHARS + 1);
    expect(job?.needs?.endsWith('…')).toBe(true);
  });

  it('reads the nested file shape and the flat wire shape, which are the same value', () => {
    // The bug a round-trip test found. This parser runs on the daemon's file AND again on its own
    // output after JSON, where `output.result` and `inFlight.tasks` have already been flattened.
    // A reader that knew only one shape dropped both on the second pass, silently.
    const fromFile = parseJobState({ output: { result: 'done' }, inFlight: { tasks: 3 } });
    const fromWire = parseJobState({ result: 'done', inFlightTasks: 3 });

    expect(fromFile?.result).toBe('done');
    expect(fromFile?.inFlightTasks).toBe(3);
    expect(fromWire).toEqual(fromFile);
  });

  it('keeps a task count of zero, which is the common reading', () => {
    // `??` and not `||`: zero outstanding tasks is a fact, and falling through to the other shape
    // for it would be the same absent-is-not-zero mistake the rest of this project avoids.
    expect(parseJobState({ inFlight: { tasks: 0 } })?.inFlightTasks).toBe(0);
  });

  it('reads an instant from an ISO string or from epoch ms', () => {
    // Same two encodings: the file writes ISO, the wire writes the number this produced.
    const iso = parseJobState({ updatedAt: '2026-09-14T12:00:00.000Z' })?.updatedAt;

    expect(iso).toBe(Date.parse('2026-09-14T12:00:00.000Z'));
    expect(parseJobState({ updatedAt: iso })?.updatedAt).toBe(iso);
  });

  it('drops a state it does not know rather than coercing it', () => {
    expect(parseJobState({ state: 'hibernating' })?.state).toBeUndefined();
  });

  it('refuses a body that is not an object, and accepts one that is merely empty', () => {
    expect(parseJobState('done')).toBeUndefined();
    expect(parseJobState(undefined)).toBeUndefined();
    // A half-written file mid-transition. Every field is an enrichment, so nothing is required.
    expect(parseJobState({})?.state).toBeUndefined();
  });
});

describe('parseTimeline', () => {
  const LINES = timelineFixture.entries.map((entry) => JSON.stringify(entry)).join('\n');

  it('reads one entry per transition, oldest first', () => {
    const entries = parseTimeline(LINES);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.state).toBe('working');
    expect(entries[1]?.state).toBe('blocked');
    expect(entries[1]?.text).toBe('text-4c493a12');
  });

  it('reads the empty `text` on entry to working as absent, not as an empty recap', () => {
    // The daemon writes `"text": ""` entering `working` (F.2.14). An empty string rendered as a
    // recap line is a blank row that looks like a bug.
    expect(parseTimeline(LINES)[0]?.text).toBeUndefined();
  });

  it('skips a line that does not parse instead of ending the read', () => {
    // A partially-flushed last line is ordinary on a file being appended to while it is read, and
    // so is a first line cut in half by reading only the tail (FsJobFiles).
    const entries = parseTimeline(`{"at":"bad`.concat('\n', LINES, '\n{"half'));

    expect(entries).toHaveLength(2);
  });

  it('ignores blank lines and a trailing newline', () => {
    expect(parseTimeline(`\n${LINES}\n\n`)).toHaveLength(2);
  });

  it('caps the assistant message, which has no documented bound', () => {
    const line = JSON.stringify({
      at: '2026-01-01T00:00:00Z',
      text: 'y'.repeat(MAX_TEXT_CHARS * 2),
    });

    expect(parseTimeline(line)[0]?.text).toHaveLength(MAX_TEXT_CHARS + 1);
  });

  it('keeps the TAIL when there are more entries than the cap', () => {
    // "What happened while I was away" is the newest transitions. A long-lived session's file has
    // its interesting lines at the end, which is also why FsJobFiles reads from the back.
    const many = Array.from({ length: MAX_TIMELINE_ENTRIES + 10 }, (unused, index) =>
      JSON.stringify({
        at: '2026-01-01T00:00:00Z',
        state: 'working',
        detail: `step-${String(index)}`,
      }),
    ).join('\n');

    const entries = parseTimeline(many);

    expect(entries).toHaveLength(MAX_TIMELINE_ENTRIES);
    expect(entries.at(-1)?.detail).toBe(`step-${String(MAX_TIMELINE_ENTRIES + 9)}`);
  });

  it('is empty for empty text rather than throwing', () => {
    expect(parseTimeline('')).toEqual([]);
  });
});
