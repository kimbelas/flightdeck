// Three levels of nesting flattened into the order things run — P3-T3, SPEC §5.1.
//
// The fixture is `app-next`'s own `settings.json` shape, trimmed: five events, a group with a
// matcher and a group without, two commands under one matcher, an `async` with no timeout and a
// conditional beside it. Those are the four cases that make a timeline different from a tree, and
// the one that matters most is order — Claude Code runs a group's commands as written, so a parser
// that sorted them would be answering a different question.
import { describe, expect, it } from 'vitest';
import { parseHookSteps, readHookTimeline } from '../../contracts/hook-timeline.ts';

const SETTINGS = {
  hooks: {
    SessionStart: [
      {
        matcher: 'startup|resume|clear|compact',
        hooks: [
          { type: 'command', command: 'node load-state.mjs', timeout: 10 },
          { type: 'command', command: 'node parallel-hint.mjs', timeout: 10 },
        ],
      },
    ],
    PreCompact: [{ hooks: [{ type: 'command', command: 'node state-dump.mjs', timeout: 15 }] }],
    PostToolUse: [
      {
        matcher: 'Edit|Write|MultiEdit',
        hooks: [
          { type: 'command', if: 'Edit(ts)', async: true, command: 'node fast-lint.mjs' },
          { type: 'command', command: 'node check-removed-symbols.mjs', timeout: 20 },
        ],
      },
    ],
  },
};

describe('readHookTimeline', () => {
  it('flattens every command into one row', () => {
    expect(readHookTimeline(SETTINGS)).toHaveLength(5);
  });

  it('keeps the order the file writes, which is the order they run', () => {
    expect(readHookTimeline(SETTINGS).map((step) => step.command)).toEqual([
      'node load-state.mjs',
      'node parallel-hint.mjs',
      'node state-dump.mjs',
      'node fast-lint.mjs',
      'node check-removed-symbols.mjs',
    ]);
  });

  it('carries the matcher down to every command in its group', () => {
    const start = readHookTimeline(SETTINGS).filter((step) => step.event === 'SessionStart');
    expect(start.map((step) => step.matcher)).toEqual([
      'startup|resume|clear|compact',
      'startup|resume|clear|compact',
    ]);
  });

  it('leaves a group with no matcher undefined rather than defaulting it to a star', () => {
    // "every time this event fires" is a materially different row from a pattern, and PreCompact
    // in the acceptance target is exactly that shape.
    const compact = readHookTimeline(SETTINGS).find((step) => step.event === 'PreCompact');
    expect(compact?.matcher).toBeUndefined();
  });

  it('reads the `if:` guard and the async badge', () => {
    const lint = readHookTimeline(SETTINGS).find((step) => step.command.includes('fast-lint'));
    expect(lint).toMatchObject({ condition: 'Edit(ts)', async: true, timeoutSeconds: undefined });
  });

  it('reads a timeout in seconds and treats a zero as none', () => {
    expect(readHookTimeline(SETTINGS)[0]?.timeoutSeconds).toBe(10);
    const zero = { hooks: { Stop: [{ hooks: [{ command: 'x', timeout: 0 }] }] } };
    expect(readHookTimeline(zero)[0]?.timeoutSeconds).toBeUndefined();
  });

  it('keeps a hook whose type this build does not know', () => {
    // A future hook type is a row worth showing with whatever it does say. Refusing it here would
    // hide a hook that runs.
    const future = { hooks: { Stop: [{ hooks: [{ type: 'webhook', command: 'x' }] }] } };
    expect(readHookTimeline(future)).toHaveLength(1);
  });

  it('answers nothing for a shape that is not hooks, rather than throwing', () => {
    expect(readHookTimeline(undefined)).toEqual([]);
    expect(readHookTimeline({ hooks: 'yes' })).toEqual([]);
    expect(readHookTimeline({ hooks: { Stop: 'one' } })).toEqual([]);
    expect(readHookTimeline({ hooks: { Stop: [{ hooks: [{ command: '' }] }] } })).toEqual([]);
  });
});

describe('parseHookSteps', () => {
  it('round-trips what the reader produced', () => {
    expect(parseHookSteps(readHookTimeline(SETTINGS))).toEqual(readHookTimeline(SETTINGS));
  });

  it('drops a row with no event or no command', () => {
    expect(parseHookSteps([{ command: 'x' }, { event: 'Stop' }, 7])).toEqual([]);
  });
});
