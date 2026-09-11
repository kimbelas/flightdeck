// The one adapter test that has to use real time, kept to milliseconds.
//
// What is worth asserting is not that `setInterval` works but that cancellation reaches it: a
// timer that outlived its `Cancellation` would keep the event loop alive and `flightdeck-core`
// would never exit on Ctrl+C, which is the bug this class's header is about.
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { NodeScheduler } from '../../../core/adapters/node/node-scheduler.ts';

describe('NodeScheduler', () => {
  it('repeats until cancelled', async () => {
    const scheduler = new NodeScheduler();
    let count = 0;
    const timer = scheduler.every(5, () => {
      count += 1;
    });

    await delay(40);
    timer.cancel();
    const atCancel = count;
    await delay(40);

    expect(atCancel).toBeGreaterThan(0);
    expect(count).toBe(atCancel);
  });

  it('runs a delayed task once', async () => {
    const scheduler = new NodeScheduler();
    let count = 0;
    scheduler.after(5, () => {
      count += 1;
    });

    await delay(40);

    expect(count).toBe(1);
  });

  it('never runs one cancelled before it was due', async () => {
    const scheduler = new NodeScheduler();
    let fired = false;
    const timer = scheduler.after(20, () => {
      fired = true;
    });

    timer.cancel();
    await delay(60);

    expect(fired).toBe(false);
  });

  it('survives being cancelled twice', () => {
    const scheduler = new NodeScheduler();
    const timer = scheduler.every(1000, () => undefined);

    timer.cancel();

    expect(() => {
      timer.cancel();
    }).not.toThrow();
  });
});
