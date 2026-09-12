// The merge has to be additive and the removal has to be exact — SEC-FS-3, SEC-ING-3, D13.
//
// The round trip is the headline test: `remove(merge(x))` is `x`, including for a settings.json
// that already had hooks of the owner's in the same events Flightdeck uses.
import { describe, expect, it } from 'vitest';
import { CONNECTED_EVENTS, CORE_HOOKS_URL } from '../../../contracts/connect-plan.ts';
import { HooksBlock } from '../../../core/application/hooks-block.ts';

const theirs = { type: 'command', command: 'python guard.py' };

function settingsWithTheirHooks(): Record<string, unknown> {
  return {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }],
      Stop: [{ hooks: [theirs] }],
    },
    statusLine: { type: 'command', command: 'python statusline.py' },
  };
}

describe('HooksBlock', () => {
  it('installs one handler per connected event and nothing else', () => {
    const merged = new HooksBlock().merge({});
    const hooks = merged['hooks'];

    expect(Object.keys(hooks as Record<string, unknown>)).toEqual([...CONNECTED_EVENTS]);
  });

  it('points every handler at the hooks route and names the env var it needs', () => {
    const merged = new HooksBlock().merge({});
    const stop = JSON.stringify((merged['hooks'] as Record<string, unknown>)['Stop']);

    expect(stop).toContain(CORE_HOOKS_URL);
    // The NAME, never a value — a literal secret in settings.json is what SEC-HTTP-7 avoids.
    expect(stop).toContain('Bearer ${FLIGHTDECK_TOKEN}');
    expect(stop).toContain('"allowedEnvVars":["FLIGHTDECK_TOKEN"]');
  });

  it('leaves the owner’s other keys and their PreToolUse hook untouched', () => {
    const before = settingsWithTheirHooks();

    const merged = new HooksBlock().merge(before);

    expect(merged['model']).toBe('opus');
    expect(merged['statusLine']).toEqual(before['statusLine']);
    expect((merged['hooks'] as Record<string, unknown>)['PreToolUse']).toEqual([
      { matcher: 'Bash', hooks: [theirs] },
    ]);
  });

  it('appends after the owner’s handler in an event they already use', () => {
    const merged = new HooksBlock().merge(settingsWithTheirHooks());
    const stop = (merged['hooks'] as Record<string, unknown>)['Stop'] as readonly unknown[];

    // Theirs first: a hook of ours that is slow must not delay one of theirs.
    expect(stop).toHaveLength(2);
    expect(stop[0]).toEqual({ hooks: [theirs] });
  });

  it('round-trips: remove(merge(x)) is x', () => {
    const block = new HooksBlock();
    const before = settingsWithTheirHooks();

    expect(block.remove(block.merge(before))).toEqual(before);
  });

  it('round-trips a settings.json that had no hooks at all, leaving no empty object behind', () => {
    const block = new HooksBlock();
    const before = { model: 'opus' };

    const after = block.remove(block.merge(before));

    expect(after).toEqual(before);
    expect('hooks' in after).toBe(false);
  });

  it('is idempotent: merging twice installs one handler, not two', () => {
    const block = new HooksBlock();

    const twice = block.merge(block.merge({}));
    const stop = (twice['hooks'] as Record<string, unknown>)['Stop'] as readonly unknown[];

    expect(stop).toHaveLength(1);
  });

  it('recognises its own handler by url, so isApplied answers before and after', () => {
    const block = new HooksBlock();

    expect(block.isApplied({})).toBe(false);
    expect(block.isApplied(settingsWithTheirHooks())).toBe(false);
    expect(block.isApplied(block.merge({}))).toBe(true);
  });

  it('keeps a handler of theirs that shared an entry with ours', () => {
    const block = new HooksBlock();
    const shared = { hooks: [theirs, { type: 'http', url: CORE_HOOKS_URL }] };

    const removed = block.remove({ hooks: { Stop: [shared] } });

    expect(removed).toEqual({ hooks: { Stop: [{ hooks: [theirs] }] } });
  });

  it('puts a hooks value that is not an array back untouched rather than normalising it', () => {
    const odd = { hooks: { Stop: 'not an array' } };

    expect(new HooksBlock().remove(odd)).toEqual(odd);
  });

  it('removing from a settings.json that was never connected changes nothing', () => {
    const before = settingsWithTheirHooks();

    expect(new HooksBlock().remove(before)).toEqual(before);
  });
});
