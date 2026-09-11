// A toast is a courtesy: the action that earned it must succeed whether or not it appears.
//
// SnoreToast is absent on CI, Focus Assist silences it, and Windows rate-limits notifications —
// three ordinary reasons a real notify does nothing, none of which may fail a session stop.
import { describe, expect, it } from 'vitest';
import type { Notification } from '../../core/ports/notifier.ts';
import { FakeNotifier } from './fake-notifier.ts';

const toast: Notification = { title: 'Done', body: 'app-next finished', sessionId: 'a' };

describe('FakeNotifier', () => {
  it('records what was raised', () => {
    const notifier = new FakeNotifier();

    notifier.notify(toast);

    expect(notifier.last).toEqual(toast);
  });

  it('does not throw when it cannot raise one', () => {
    const notifier = new FakeNotifier();
    notifier.failNext = true;

    expect(() => {
      notifier.notify(toast);
    }).not.toThrow();
    expect(notifier.raised).toHaveLength(0);
  });

  it('selects by session, which is what a per-session mute is asserted against', () => {
    const notifier = new FakeNotifier();
    notifier.notify(toast);
    notifier.notify({ ...toast, sessionId: 'b' });

    expect(notifier.forSession('a')).toHaveLength(1);
  });
});
