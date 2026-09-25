// `taskkill` as the take-over's ender — P6-T8, D63, RESEARCH.md G.60.
//
// G.60 measured the fact this file is about: with the image filter, taskkill exits 0 whether it
// ended the process or left it alone. So the adapter's answer must come from the probe, and a
// test that only checked the exit code would pass on the exact failure the filter exists for.
import { describe, expect, it } from 'vitest';
import { TaskkillProcessEnder } from '../../../core/adapters/windows/taskkill-process-ender.ts';
import { FakeProcessProbe } from '../../fakes/fake-process-probe.ts';
import { FakeProcessRunner } from '../../fakes/fake-process-runner.ts';

const TASKKILL = 'C:\\Windows\\System32\\taskkill.exe';

interface Built {
  readonly ender: TaskkillProcessEnder;
  readonly runner: FakeProcessRunner;
  readonly pauses: number[];
}

function build(probe: FakeProcessProbe = new FakeProcessProbe()): Built {
  const runner = new FakeProcessRunner();
  runner.willReturn({ code: 0 });
  const pauses: number[] = [];
  const ender = new TaskkillProcessEnder({
    taskkill: TASKKILL,
    runner,
    probe,
    pause: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  });
  return { ender, runner, pauses };
}

describe('TaskkillProcessEnder', () => {
  it('ends the tree, forced, and only if it is claude.exe', async () => {
    const { ender, runner } = build();

    await ender.end(5300);

    expect(runner.requests[0]?.command).toBe(TASKKILL);
    expect(runner.requests[0]?.args).toEqual([
      '/PID',
      '5300',
      '/FI',
      'IMAGENAME eq claude.exe',
      '/T',
      '/F',
    ]);
  });

  it('answers true once the probe no longer sees the pid', async () => {
    const { ender } = build();

    expect(await ender.end(5300)).toBe(true);
  });

  // The filter's case: taskkill exits 0 and the process is still there, because it was not
  // `claude.exe`. The adapter waits the budget out and says so rather than trusting the exit code.
  it('answers false when the pid is still alive after the wait, whatever taskkill said', async () => {
    const { ender, pauses } = build(new FakeProcessProbe().willBeAlive(5300));

    expect(await ender.end(5300)).toBe(false);
    expect(pauses.reduce((total, ms) => total + ms, 0)).toBe(5000);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses the pid %s without running anything', async (pid) => {
    const { ender, runner } = build();

    expect(await ender.end(pid)).toBe(false);
    expect(runner.requests).toEqual([]);
  });

  it('gives taskkill Windows’ own variables and none of the owner’s', async () => {
    const { ender, runner } = build();

    await ender.end(5300);

    expect(Object.keys(runner.requests[0]?.env ?? {})).toEqual(['SystemRoot']);
  });
});
