// Raising a Windows toast — P6-T3, and the one thing this file really guards.
//
// **`toasted-notifier` is not stubbed here, and that is the point.** The module is imported for
// real, exactly as core imports it, and every test below runs on whatever platform the suite runs
// on. On a Linux CI runner that library's path is `notify-send` through `cp.exec` — a SHELL, where
// the Windows path is `execFile` — and a toast body carries a session name, which is the owner's
// own text. The guard is what makes that unreachable, so a test that mocked the library away would
// be testing the mock rather than the sentence that matters.
//
// The port's promise is the other half: `notify` throws nothing, ever. A missing SnoreToast, Focus
// Assist, a spent notification budget and a Windows that cannot start a process at all are four
// ways for this to fail, and none of them may reach the thing that earned the toast.
import { describe, expect, it } from 'vitest';
import { WindowsToastNotifier } from '../../../core/adapters/windows/windows-toast-notifier.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';

const NOTIFICATION = {
  title: 'Claude needs you',
  body: 'alpha',
  sessionId: '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
} as const;

describe('WindowsToastNotifier', () => {
  it('does nothing at all off Windows — the library would reach a shell there', () => {
    const logger = new FakeLogger();

    new WindowsToastNotifier(logger, false).notify(NOTIFICATION);

    expect(logger.lines).toEqual([]);
  });

  it('defaults to the platform, so nothing has to remember to pass the flag', () => {
    // Constructing it is the assertion: the default argument is `process.platform === 'win32'`,
    // and this call is what would raise a real toast on the owner's desktop if it were wrong on a
    // machine that is not Windows.
    const notifier = new WindowsToastNotifier(new FakeLogger());

    expect(notifier).toBeInstanceOf(WindowsToastNotifier);
  });

  // The port says a toast is a courtesy. Every value below is one a caller could really hand it.
  it.each([
    { notification: NOTIFICATION, why: 'an ordinary toast' },
    { notification: { ...NOTIFICATION, body: '' }, why: 'an empty body' },
    { notification: { ...NOTIFICATION, title: '' }, why: 'an empty title' },
    { notification: { ...NOTIFICATION, body: '-silent' }, why: 'a body that is a flag' },
    {
      notification: { ...NOTIFICATION, body: 'alpha " & | ; $(echo)' },
      why: 'a body with shell metacharacters in it',
    },
    { notification: { ...NOTIFICATION, body: 'a'.repeat(4096) }, why: 'a very long body' },
  ])('never throws on $why', ({ notification }) => {
    const notifier = new WindowsToastNotifier(new FakeLogger(), false);

    expect(() => {
      notifier.notify(notification);
    }).not.toThrow();
  });
});
