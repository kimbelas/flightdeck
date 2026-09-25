// What Claude actually did in a folder — P3-T5, SPEC §5.1(b).
//
// It runs after `projectViewChecks`, which imports `ledger` and leaves it imported, because this
// group needs a project row and has nothing to say about how one gets there.
//
// **The first check is that nothing happened.** Every other panel on a project row fetches itself
// as soon as the registry arrives; this one must not, because it reads every transcript of the
// folder in both subscriptions (90 MB and about a second for this repository's own). So the group
// opens the panel, asserts core was NOT asked, and only then presses the button — which is the one
// ordering that can tell a button apart from a poll that happens to be slow.
import { waitFor } from './report.mjs';

const LEDGER = String.raw`C:\Users\owner\Documents\ledger`;
const OBSERVED_PATH = '/projects/observed';

export async function observedChecks(page, report, core) {
  report.group('What Claude did here — the transcript reading (P3-T5)');

  const before = countReads(core);
  await openPanel(page, report, before);
  await readingChecks(page, report, core, before);
  await adjacencyCheck(page, report);
  await forgetChecks(page, report, core);
}

/** Every `/projects/observed` core has been asked for, in this run so far. */
function countReads(core) {
  return core.requests.filter((request) => request.path === OBSERVED_PATH).length;
}

/**
 * Opening the panel, and the sentence that is there instead of a number.
 *
 * The explainer is checked for the COST rather than for its wording: what it has to do is warn,
 * and a panel that opened with a spinner and no warning would be the thing this design rejects.
 */
async function openPanel(page, report, before) {
  report.check(
    'nothing is read before the panel is even open — no request went out with the registry',
    before === 0,
    `${String(before)} reads so far`,
  );

  await page.locator('summary', { hasText: 'what Claude did here' }).click();
  const body = page.locator('[data-observed="ledger"]');
  const open = await waitFor(async () => await body.isVisible());
  report.check('the panel opens on the project row', open);

  const note = (await page.locator('.project-observed-note').allTextContents())[0] ?? '(none)';
  report.check(
    'and says what the read would cost instead of starting it',
    note.includes('Nothing is read until you ask') && /megabytes|second/u.test(note),
    note,
  );
}

/** The press, and every number the reading puts on screen. */
async function readingChecks(page, report, core, before) {
  await page.locator('[data-observed-read]').click();
  const asked = await waitFor(() => countReads(core) === before + 1);
  report.check(
    'pressing the button is what sends the request, and it sends exactly one',
    asked,
    `${String(countReads(core))} reads`,
  );

  const head = page.locator('.observed-head');
  const drawn = await waitFor(async () => (await head.count()) === 1);
  const headline = ((await head.allTextContents())[0] ?? '(none)').replaceAll(/\s+/gu, ' ');
  report.check('the reading arrives and is drawn', drawn);
  report.check(
    'with the session count and how many of them are this week',
    headline.includes('42') && headline.includes('9 this week'),
    headline,
  );
  report.check(
    'and BOTH subscriptions, each with its own cost — the split is the point of the panel',
    headline.includes('$18.40') && headline.includes('$6.05'),
    headline,
  );
  report.check(
    'and the median peak context, in thousands of tokens rather than raw',
    headline.includes('137k tokens'),
    headline,
  );
  report.check(
    'and the two counts nothing else on the deck reports — compactions and scheduled fires',
    headline.includes('compactions') && headline.includes('scheduled fires'),
    headline,
  );

  await countsChecks(page, report);
  await footnoteChecks(page, report);
}

/** The four lists. Each is a `data-` attribute, so a missing one fails rather than reads empty. */
async function countsChecks(page, report) {
  for (const label of ['tools', 'skills', 'session names', 'files']) {
    const list = page.locator(`[data-observed-counts="${label}"]`);
    const text = ((await list.allTextContents())[0] ?? '(none)').replaceAll(/\s+/gu, ' ');
    report.check(`the reading lists ${label}`, (await list.count()) === 1, text);
  }

  // P7-T4, SPEC §6(11). By kind, with its fires, its sessions and its age — and the cron kept to
  // the tooltip, because for a loop it is only the minute the next wake-up chose.
  const scheduled = page.locator('[data-observed-counts="scheduled"] .observed-count');
  const pill = ((await scheduled.allTextContents())[0] ?? '(none)').replaceAll(/\s+/gu, ' ');
  const cron = (await scheduled.first().getAttribute('title')) ?? '';
  report.check(
    'scheduled tasks are listed by kind — the loop, its fires, sessions and last fire',
    pill.includes('loop') &&
      pill.includes('2') &&
      pill.includes('1 session') &&
      pill.includes('3h ago'),
    pill,
  );
  report.check(
    'and the last cron rides the tooltip, not the pill',
    cron === 'last cron 27 10 * * *',
    cron,
  );

  const names = page.locator('[data-observed-counts="session names"]');
  const text = ((await names.allTextContents())[0] ?? '').replaceAll(/\s+/gu, ' ');
  // SPEC asks for "subagents" here and `agent-name` is the SESSION's name — the correction is
  // named in contracts/observed-behaviour.ts, and this is the check that keeps it honest.
  report.check(
    'and the names it lists are session names, not a subagent roster SPEC assumed was there',
    text.includes('ledger') && text.includes('583'),
    text,
  );
}

/** What it cost, and the drift alarm — SPEC §8 R2's, over a whole folder. */
async function footnoteChecks(page, report) {
  const note = page.locator('.project-observed-note');
  const text = ((await note.allTextContents())[0] ?? '(none)').replaceAll(/\s+/gu, ' ');
  report.check(
    'the panel says what the read cost, now that it has been paid',
    text.includes('84 MB') && text.includes('1149 ms'),
    text,
  );

  const drift = page.locator('[data-observed-drift]');
  const shown = await waitFor(async () => (await drift.count()) === 1);
  const driftText = ((await drift.allTextContents())[0] ?? '(none)').replaceAll(/\s+/gu, ' ');
  report.check(
    'and raises the drift alarm when lines came back in a shape this build has never seen',
    shown && driftText.includes('5 lines'),
    driftText,
  );
}

/**
 * The map and the reading are adjacent — SPEC §5.1(b)'s whole argument.
 *
 * The contrast between what Claude is CONFIGURED to do here and what it ACTUALLY did is the thing
 * nothing else shows, and it is only a contrast if the two are next to each other. A check on the
 * class names alone would pass with them at opposite ends of the row.
 */
async function adjacencyCheck(page, report) {
  const order = await page.evaluate(() => {
    const row = document.querySelector('.project');
    if (row === null) return [];
    return [...row.querySelectorAll('.project-detail')].map((node) =>
      node.classList.contains('project-observed') ? 'observed' : 'map',
    );
  });
  report.check(
    'the configured map and the observed reading sit side by side, in that order',
    order.join(',') === 'map,observed',
    order.join(' then ') || '(no panels)',
  );
}

/**
 * Withdrawing the folder takes the reading with it.
 *
 * Core will refuse to read this folder from here the moment it is forgotten (SEC-FS-1), so a tally
 * left on screen would be the deck showing what it is no longer allowed to look at. Re-importing
 * puts the row back with the button unpressed, which is the observable half.
 */
async function forgetChecks(page, report, core) {
  await page.locator('.project button', { hasText: 'forget' }).click();
  const gone = await waitFor(() => core.projects.size === 0);
  report.check('the folder can be withdrawn again', gone);

  await page.fill('#project-path', LEDGER);
  await page.locator('.project-add button', { hasText: 'import' }).click();
  const back = await waitFor(async () => (await page.locator('.project').count()) === 1);
  report.check('and re-imported', back);

  await page.locator('summary', { hasText: 'what Claude did here' }).click();
  const note = (await page.locator('.project-observed-note').allTextContents())[0] ?? '(none)';
  report.check(
    'the reading did not survive the withdrawal — the button is back, unpressed',
    (await page.locator('.observed-head').count()) === 0 &&
      note.includes('Nothing is read until you ask'),
    note,
  );
}
