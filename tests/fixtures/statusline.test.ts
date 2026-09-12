// Locks in the statusLine stdin shape measured in P0-T5 (RESEARCH.md F.3.5).
//
// P1-T6 parses this payload and P2-T3 renders the deck header straight out of it, so the trap
// here is worth pinning early: on a session that has not taken a turn yet the numeric fields are
// present and **null**, not absent and not zero. A schema that treats them as optional numbers
// accepts the shape; one that treats "no value" as "key missing" rejects a real payload, and one
// that defaults null to 0 paints a 0 % context bar on every new session.
import { describe, expect, it } from 'vitest';
import { parseStatuslineReport } from '../../contracts/statusline-report.ts';
import fresh from '../../fixtures/statusline/fresh.json' with { type: 'json' };
import warm from '../../fixtures/statusline/warm.json' with { type: 'json' };

describe('statusLine payload', () => {
  it('reports context usage as null, not 0, before the first turn', () => {
    expect(fresh.context_window.used_percentage).toBeNull();
    expect(fresh.context_window.remaining_percentage).toBeNull();
    expect(fresh.context_window.current_usage).toBeNull();
    // The window size is known from the start, so it is never inferred from the model name (D.3).
    expect(fresh.context_window.context_window_size).toBe(200_000);
  });

  it('omits session_name, prompt_id and prompt_cache until they exist', () => {
    expect(fresh).not.toHaveProperty('session_name');
    expect(fresh).not.toHaveProperty('prompt_id');
    expect(fresh).not.toHaveProperty('prompt_cache');
    expect(warm.session_name).toBeTypeOf('string');
    expect(warm.prompt_id).toBeTypeOf('string');
  });

  it('carries both quota windows on every payload — the deck header (P2-T3)', () => {
    for (const payload of [fresh, warm]) {
      expect(payload.rate_limits.five_hour.used_percentage).toBeTypeOf('number');
      // resets_at is Unix *seconds*, so it is 10 digits, not 13 — milliseconds would render a
      // countdown of thousands of hours and `until()` would silently drop the chip.
      expect(String(payload.rate_limits.five_hour.resets_at)).toHaveLength(10);
      expect(payload.rate_limits.seven_day.used_percentage).toBeTypeOf('number');
    }
  });

  it('carries the whole prompt-cache picture once a turn has run', () => {
    expect(warm.prompt_cache.hit_ratio).toBeGreaterThan(0);
    expect(warm.prompt_cache.warm).toBe(true);
    expect(warm.prompt_cache.ttl).toBe('1h');
    expect(String(warm.prompt_cache.expires_at)).toHaveLength(10);
  });

  it('keeps the model id intact through the scrubber, because the avatar maps off it', () => {
    expect(warm.model.id).toMatch(/^claude-/);
    expect(warm.model.display_name).toBeTypeOf('string');
  });

  it('has the three fields the documented list in RESEARCH.md D.3 misses', () => {
    expect(warm.scratchpad_dir).toBeTypeOf('string');
    expect(warm.output_style.name).toBeTypeOf('string');
    expect(warm.thinking.enabled).toBeTypeOf('boolean');
  });
});

describe('the captured payloads through the real parser (P1-T6)', () => {
  it('accepts both shapes', () => {
    expect(parseStatuslineReport(fresh)).toBeDefined();
    expect(parseStatuslineReport(warm)).toBeDefined();
  });

  it('reads the fresh capture as no context usage rather than as none used', () => {
    const report = parseStatuslineReport(fresh);

    expect(report?.usedPercentage).toBeUndefined();
    expect(report?.contextWindowSize).toBe(200_000);
  });

  it('reads the warm capture as a real percentage and a real cost', () => {
    const report = parseStatuslineReport(warm);

    expect(report?.usedPercentage).toBe(20);
    expect(report?.costUsd).toBeGreaterThan(0);
    expect(report?.sessionName).toBe(warm.session_name);
  });

  it('gets both quota windows off either capture, in milliseconds', () => {
    for (const capture of [fresh, warm]) {
      const report = parseStatuslineReport(capture);

      expect(report?.fiveHour.usedPercentage).toBe(capture.rate_limits.five_hour.used_percentage);
      expect(report?.fiveHour.resetsAt).toBe(capture.rate_limits.five_hour.resets_at * 1000);
      expect(report?.sevenDay.resetsAt).toBe(capture.rate_limits.seven_day.resets_at * 1000);
    }
  });
});
