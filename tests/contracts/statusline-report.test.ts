// P1-T6. The trap first: before the first turn the numbers are present and NULL.
//
// A parser that models "no value" as a missing key rejects a real payload; one that coerces `null`
// to `0` paints a 0 %-used context bar on every session that has not spoken yet (RESEARCH.md
// F.3.5). Both mistakes are cheap to make and neither one looks wrong on screen.
import { describe, expect, it } from 'vitest';
import { parseStatuslineReport } from '../../contracts/statusline-report.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';

const PAYLOAD = {
  session_id: SESSION,
  transcript_path: 'C:\\Users\\dev\\.claude-isg\\projects\\p\\t.jsonl',
  session_name: 'text-70796d57',
  model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
  version: '2.1.267',
  cost: { total_cost_usd: 0.0207387, total_duration_ms: 11571 },
  context_window: { used_percentage: 20, remaining_percentage: 80, context_window_size: 200000 },
  rate_limits: {
    five_hour: { used_percentage: 23, resets_at: 1789080600 },
    seven_day: { used_percentage: 7.000000000000001, resets_at: 1789650000 },
  },
};

describe('parseStatuslineReport — null is not zero', () => {
  it('reads a fresh session as "no value", not as 0 %', () => {
    const fresh = {
      ...PAYLOAD,
      context_window: {
        used_percentage: null,
        remaining_percentage: null,
        current_usage: null,
        context_window_size: 200000,
      },
    };

    const report = parseStatuslineReport(fresh);

    expect(report?.usedPercentage).toBeUndefined();
    expect(report?.usedPercentage).not.toBe(0);
    // The rest of the payload is still worth having — the quota numbers are there from the start.
    expect(report?.fiveHour.usedPercentage).toBe(23);
  });

  it('keeps a real zero as a zero', () => {
    const report = parseStatuslineReport({
      ...PAYLOAD,
      context_window: { used_percentage: 0, context_window_size: 200000 },
      cost: { total_cost_usd: 0 },
    });

    expect(report?.usedPercentage).toBe(0);
    expect(report?.costUsd).toBe(0);
  });
});

describe('parseStatuslineReport — what it accepts', () => {
  it('projects the fields the deck draws', () => {
    expect(parseStatuslineReport(PAYLOAD)).toMatchObject({
      sessionId: SESSION,
      sessionName: 'text-70796d57',
      modelId: 'claude-haiku-4-5-20251001',
      modelName: 'Haiku 4.5',
      claudeVersion: '2.1.267',
      costUsd: 0.0207387,
      usedPercentage: 20,
      contextWindowSize: 200000,
    });
  });

  it('converts resets_at from seconds to milliseconds, once, here', () => {
    // Everything else in this codebase is epoch ms. A comparison against Date.now() in seconds is
    // always in the past and never looks wrong.
    const report = parseStatuslineReport(PAYLOAD);

    expect(report?.fiveHour.resetsAt).toBe(1789080600 * 1000);
    expect(report?.sevenDay.resetsAt).toBe(1789650000 * 1000);
  });

  it('survives a payload with no optional blocks at all', () => {
    const bare = { session_id: SESSION, transcript_path: 'C:\\x\\.claude-isg\\t.jsonl' };

    const report = parseStatuslineReport(bare);

    expect(report?.sessionId).toBe(SESSION);
    expect(report?.usedPercentage).toBeUndefined();
    expect(report?.fiveHour.usedPercentage).toBeUndefined();
    expect(report?.sevenDay.resetsAt).toBeUndefined();
  });

  it('ignores the fields Flightdeck has no use for', () => {
    // `prompt_cache` alone carries fourteen. What is never read cannot leak or surprise.
    const report = parseStatuslineReport({ ...PAYLOAD, prompt_cache: { warm: true, ttl: '1h' } });

    expect(report).toBeDefined();
    expect(JSON.stringify(report)).not.toContain('warm');
  });
});

describe('parseStatuslineReport — what it refuses', () => {
  it('refuses a payload with no session id or no transcript path', () => {
    // Without either, the render cannot be attributed to a session or a subscription.
    expect(parseStatuslineReport({ ...PAYLOAD, session_id: undefined })).toBeUndefined();
    expect(parseStatuslineReport({ ...PAYLOAD, transcript_path: undefined })).toBeUndefined();
    expect(parseStatuslineReport({ ...PAYLOAD, session_id: 'not-a-uuid' })).toBeUndefined();
  });

  it('refuses anything that is not an object', () => {
    expect(parseStatuslineReport(undefined)).toBeUndefined();
    expect(parseStatuslineReport(null)).toBeUndefined();
    expect(parseStatuslineReport([PAYLOAD])).toBeUndefined();
  });

  it('drops a bad number without throwing the render away', () => {
    // A render arrives every second or so; refusing the whole payload because one field changed
    // shape would throw away the quota numbers with it.
    const report = parseStatuslineReport({
      ...PAYLOAD,
      context_window: { used_percentage: 130, context_window_size: -1 },
      cost: { total_cost_usd: -5 },
    });

    expect(report?.usedPercentage).toBeUndefined();
    expect(report?.contextWindowSize).toBeUndefined();
    expect(report?.costUsd).toBeUndefined();
    expect(report?.fiveHour.usedPercentage).toBe(23);
  });

  it('drops a block of the wrong type rather than reading through it', () => {
    const report = parseStatuslineReport({ ...PAYLOAD, model: 'Haiku', rate_limits: [] });

    expect(report?.modelId).toBeUndefined();
    expect(report?.fiveHour.usedPercentage).toBeUndefined();
  });
});
