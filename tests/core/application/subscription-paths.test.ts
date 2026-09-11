// P1-T5. Which subscription sent a hook, decided by where its transcript lives.
//
// Every test here is a way of getting it wrong: a prefix that is not a directory, a separator that
// is the other one, a case that does not match, a path from neither subscription. Getting it wrong
// means events attributed to the wrong config dir, and every consumer downstream keys off the pair.
import { describe, expect, it } from 'vitest';
import { SubscriptionPaths } from '../../../core/application/subscription-paths.ts';

const ROOTS = {
  '365': 'C:\\Users\\dev\\.claude-365',
  isg: 'C:\\Users\\dev\\.claude-isg',
};

const paths = new SubscriptionPaths(ROOTS);

describe('SubscriptionPaths', () => {
  it('reads the subscription off a real transcript path', () => {
    expect(paths.of('C:\\Users\\dev\\.claude-isg\\projects\\p\\t.jsonl')).toBe('isg');
    expect(paths.of('C:\\Users\\dev\\.claude-365\\projects\\p\\t.jsonl')).toBe('365');
  });

  it('ignores case and separator, because Windows produces both', () => {
    expect(paths.of('c:\\users\\dev\\.claude-365\\projects\\p\\t.jsonl')).toBe('365');
    expect(paths.of('C:/Users/dev/.claude-isg/projects/p/t.jsonl')).toBe('isg');
  });

  it('refuses a sibling directory that merely starts the same way', () => {
    // A bare `startsWith` reads this as the 365 subscription, and an unrelated tool's backup
    // folder starts attributing events to a real one.
    expect(paths.of('C:\\Users\\dev\\.claude-365-backup\\projects\\p\\t.jsonl')).toBeUndefined();
  });

  it('refuses the root itself, which is a directory and not a transcript', () => {
    expect(paths.of('C:\\Users\\dev\\.claude-365')).toBeUndefined();
  });

  it('refuses a path from neither subscription rather than guessing', () => {
    // Fail closed: an event attributed to the wrong subscription is worse than one refused.
    expect(paths.of('C:\\Users\\dev\\.claude\\projects\\p\\t.jsonl')).toBeUndefined();
    expect(paths.of('C:\\Windows\\Temp\\t.jsonl')).toBeUndefined();
  });

  it('refuses an absent or empty path', () => {
    expect(paths.of(undefined)).toBeUndefined();
    expect(paths.of('')).toBeUndefined();
  });

  it('never matches an empty root, so an unset USERPROFILE matches nothing', () => {
    // `ClaudeInstall` falls back to '' when USERPROFILE is unset; a root of '' would otherwise
    // turn into a prefix that every path starts with.
    const unset = new SubscriptionPaths({ '365': '', isg: '' });

    expect(unset.of('C:\\anything\\at\\all.jsonl')).toBeUndefined();
  });
});
