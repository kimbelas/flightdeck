// Pressing a preset group from the deck — P6-T4, D17.
//
// The one button that spends real money on a single press, so the cases below are mostly about not
// pressing it: a double-click that never becomes a request, and a refusal that does not get
// mistaken for a report.
import { describe, expect, it } from 'vitest';
import { CORE_GROUP_LAUNCH_PATH } from '../../contracts/deck-routes.ts';
import { GroupSlice, type GroupHeld } from '../../app/deck/group-slice.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const REPORT = {
  group: 'morning',
  outcomes: [
    { presetId: 'a', name: 'orchestrator', sessionId: 'sess-a' },
    { presetId: 'b', name: 'ticket', failure: 'launch_failed' },
  ],
};

interface Built {
  readonly api: FakeDeckApi;
  readonly slice: GroupSlice;
  readonly published: Partial<GroupHeld>[];
}

function build(): Built {
  const api = new FakeDeckApi();
  const published: Partial<GroupHeld>[] = [];
  const slice = new GroupSlice(api, (changes) => published.push(changes));
  return { api, slice, published };
}

/** The last publish that actually carried a report or a refusal. */
function settled(published: readonly Partial<GroupHeld>[]): Partial<GroupHeld> | undefined {
  return published.at(-1);
}

describe('GroupSlice — pressing', () => {
  it('sends the name to the group path and keeps the report', async () => {
    const { api, slice, published } = build();
    api.willAnswer(200, REPORT);

    expect(await slice.launch('morning')).toBe(true);

    expect(api.requests).toEqual([
      { method: 'POST', path: CORE_GROUP_LAUNCH_PATH, body: { group: 'morning' } },
    ]);
    expect(settled(published)?.groupReport?.outcomes.length).toBe(2);
  });

  /**
   * A partial failure is an accepted press, not a refusal.
   *
   * Three started and one did not is the normal shape of a bad morning — a preset naming a worktree
   * that was deleted last night. The report is the only thing that can say which, which is why it
   * is kept rather than reduced to a boolean.
   */
  it('reads a press where one preset failed as a success, and says which one', async () => {
    const { api, slice, published } = build();
    api.willAnswer(200, REPORT);

    expect(await slice.launch('morning')).toBe(true);

    const report = settled(published)?.groupReport;
    expect(report?.outcomes.map((one) => [one.name, one.failure])).toEqual([
      ['orchestrator', undefined],
      ['ticket', 'launch_failed'],
    ]);
    expect(settled(published)?.groupRefusal).toBeUndefined();
  });

  it('clears the last press when asked', () => {
    const { slice, published } = build();

    slice.clear();

    expect(published).toEqual([{ groupReport: undefined, groupRefusal: undefined }]);
  });
});

describe('GroupSlice — not pressing', () => {
  /**
   * A double-click never becomes a second request.
   *
   * Core refuses one too (`GroupLauncher`), and core's is the guard that counts because a second
   * TAB cannot get past it. This one stops the second press from travelling at all, so the deck
   * never draws a `busy` error for something the owner did not really do twice.
   */
  it('drops a second press while the first is still out', async () => {
    const { api, slice } = build();
    api.willAnswer(200, REPORT);

    const first = slice.launch('morning');
    expect(await slice.launch('morning')).toBe(false);
    await first;

    expect(api.requests.length).toBe(1);
  });

  it('lets go once the press is done, so the entry is not wedged', async () => {
    const { api, slice } = build();
    api.willAnswer(200, REPORT);

    await slice.launch('morning');
    expect(await slice.launch('morning')).toBe(true);

    expect(api.requests.length).toBe(2);
  });

  it.each([
    { status: 409, body: { error: 'busy' }, refusal: 'busy', why: 'a 409' },
    { status: 400, body: { error: 'unknown_group' }, refusal: 'unknown_group', why: 'a 400' },
    { status: 400, body: { error: 'too_many' }, refusal: 'too_many', why: 'a group over the cap' },
  ])('keeps core’s code for $why', async ({ status, body, refusal }) => {
    const { api, slice, published } = build();
    api.willAnswer(status, body);

    expect(await slice.launch('morning')).toBe(false);

    expect(settled(published)).toEqual({ groupRefusal: refusal });
  });

  /**
   * An unreachable core reads as `busy`, and that is the safe way round.
   *
   * The press may well have arrived and started sessions — the reply is what went missing. Saying
   * "it is already doing something" stops a second press from spending quota core may have spent
   * already, which is the mistake that costs money rather than the one that costs a click.
   */
  it('treats a press that reached nobody as busy rather than as a failure to press', async () => {
    const { api, slice, published } = build();
    api.willNotAnswer();

    expect(await slice.launch('morning')).toBe(false);

    expect(settled(published)).toEqual({ groupRefusal: 'busy' });
  });

  it.each([
    { body: '<!doctype html>', why: 'a 200 carrying something that is not JSON' },
    { body: { group: 'morning' }, why: 'a 200 with no outcomes in it' },
    { body: { outcomes: [] }, why: 'a 200 with no group in it' },
  ])('does not read $why as a press that happened', async ({ body }) => {
    const { api, slice, published } = build();
    api.willAnswer(200, body);

    expect(await slice.launch('morning')).toBe(false);

    expect(settled(published)?.groupReport).toBeUndefined();
  });

  // An unknown code from a newer core must not be shown raw (CODING-STANDARDS §11 rule 1).
  it('falls back to busy for a refusal this build does not know', async () => {
    const { api, slice, published } = build();
    api.willAnswer(400, { error: 'quota_exhausted' });

    await slice.launch('morning');

    expect(settled(published)).toEqual({ groupRefusal: 'busy' });
  });
});
