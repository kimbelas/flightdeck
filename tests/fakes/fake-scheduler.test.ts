// Every reconciler timing test rests on this, so its own semantics are worth pinning: `tick`
// fires the repeating tasks and nothing else, `advance` fires only the delayed ones that came
// due, and a cancelled task is gone rather than merely ignored.
import { describe, expect, it } from 'vitest';
import { FakeScheduler } from './fake-scheduler.ts';

describe('FakeScheduler — repeating', () => {
  it('fires every repeating task on a tick', () => {
    const scheduler = new FakeScheduler();
    const fired: string[] = [];
    scheduler.every(10, () => fired.push('a'));
    scheduler.every(99, () => fired.push('b'));

    scheduler.tick();

    expect(fired).toEqual(['a', 'b']);
  });

  it('fires them again on the next tick', () => {
    const scheduler = new FakeScheduler();
    let count = 0;
    scheduler.every(10, () => {
      count += 1;
    });

    scheduler.tick();
    scheduler.tick();

    expect(count).toBe(2);
  });

  it('forgets a cancelled task rather than skipping it', () => {
    const scheduler = new FakeScheduler();
    let count = 0;
    const timer = scheduler.every(10, () => {
      count += 1;
    });

    timer.cancel();
    scheduler.tick();

    expect(count).toBe(0);
    expect(scheduler.repeatingCount).toBe(0);
  });
});

describe('FakeScheduler — delayed', () => {
  it('does not fire before the delay has elapsed', () => {
    const scheduler = new FakeScheduler();
    let fired = false;
    scheduler.after(200, () => {
      fired = true;
    });

    scheduler.advance(199);

    expect(fired).toBe(false);
  });

  it('fires exactly once when it comes due', () => {
    const scheduler = new FakeScheduler();
    let count = 0;
    scheduler.after(200, () => {
      count += 1;
    });

    scheduler.advance(200);
    scheduler.advance(200);

    expect(count).toBe(1);
    expect(scheduler.pendingCount).toBe(0);
  });

  it('accumulates across several advances', () => {
    const scheduler = new FakeScheduler();
    let fired = false;
    scheduler.after(200, () => {
      fired = true;
    });

    scheduler.advance(100);
    scheduler.advance(100);

    expect(fired).toBe(true);
  });

  it('never fires a cancelled one', () => {
    const scheduler = new FakeScheduler();
    let fired = false;
    const timer = scheduler.after(200, () => {
      fired = true;
    });

    timer.cancel();
    scheduler.advance(1000);

    expect(fired).toBe(false);
  });

  it('leaves repeating tasks alone when time advances', () => {
    const scheduler = new FakeScheduler();
    let count = 0;
    scheduler.every(10, () => {
      count += 1;
    });

    scheduler.advance(10_000);

    expect(count).toBe(0);
  });
});
