// Cost per week, subscription and project — P7-T3, SPEC §6(9).
//
// It runs after `observedChecks`, which leaves `ledger` imported: the panel names a slug by the
// imported folder it belongs to, and the only way to see that happen is with one imported.
//
// **The first check is that nothing was asked.** The panel reads when it is opened; a panel that
// fetched with the registry, or on a timer, would pass every later check and still be wrong. The
// fixture's numbers are built through the REAL `SpendReport` (fixture-core.mjs), so what these
// assert is that the deck draws what core's own pivot produces.
import { waitFor } from './report.mjs';

const SPEND_PATH = '/analytics/spend';

export async function spendChecks(page, report, core) {
  report.group('Spend — cost per week, subscription and project (P7-T3)');

  await openChecks(page, report, core);
  await weekChecks(page, report);
  await projectChecks(page, report);
  await refreshChecks(page, report, core);
  // Closed again, so a later group's screenshot is of the deck it expects.
  await page.locator('.spend > summary').click();
}

function countReads(core) {
  return core.requests.filter((request) => request.path === SPEND_PATH).length;
}

function text(values) {
  return (values[0] ?? '(none)').replaceAll(/\s+/gu, ' ').trim();
}

async function openChecks(page, report, core) {
  const before = countReads(core);
  report.check(
    'nothing asks for the spend summary before the panel is opened',
    before === 0,
    `${String(before)} reads`,
  );

  await page.locator('.spend > summary').click();
  const asked = await waitFor(() => countReads(core) === 1);
  report.check(
    'opening the panel is what asks, exactly once',
    asked,
    `${String(countReads(core))} reads`,
  );

  const drawn = await waitFor(async () => (await page.locator('[data-spend-week]').count()) === 8);
  report.check('the panel draws all eight weeks, the empty ones included', drawn);

  const summary = text(await page.locator('.spend > summary').allTextContents());
  report.check(
    'and its heading carries the whole window once it has read',
    summary.includes('$36.75 over 8 weeks'),
    summary,
  );

  const coverage = text(await page.locator('[data-spend-coverage]').allTextContents());
  report.check(
    'and says the ledger is still reading, so a low week is not taken for a quiet one',
    coverage.includes('Still reading: 3 of 41 transcripts'),
    coverage,
  );
}

async function weekChecks(page, report) {
  const totals = text(await page.locator('[data-spend-totals]').allTextContents());
  report.check(
    'it totals the window per subscription, both accounts',
    totals.includes('365 $13.65') && totals.includes('isg $23.10'),
    totals,
  );

  const current = page.locator('.spend-week.is-current');
  const line = text(await current.allTextContents());
  report.check(
    'the current week is marked, with its cost and a distinct session count',
    (await current.count()) === 1 && line.includes('$15.50') && line.includes('3 sessions'),
    line,
  );

  const widths = await current
    .locator('.spend-seg')
    .evaluateAll((segments) => segments.map((segment) => segment.getBoundingClientRect().width));
  report.check(
    'and its bar is split between the two accounts, both drawn',
    widths.length === 2 && widths.every((width) => width > 0),
    widths.map((width) => width.toFixed(0)).join(' + '),
  );
}

async function projectChecks(page, report) {
  const ledger = page.locator('[data-spend-project="ledger"]');
  const line = text(await ledger.allTextContents());
  report.check(
    'the imported folder is named by the registry, not by its slug',
    (await ledger.count()) === 1,
    line,
  );
  report.check(
    'with its cost, which account paid, and each session counted once across weeks',
    line.includes('$32.40') &&
      line.includes('isg $20.00 · 365 $12.40') &&
      line.includes('3 sessions'),
    line,
  );

  const order = await page
    .locator('[data-spend-project]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-spend-project')));
  report.check(
    'a folder nobody imported is listed as its slug, after the costlier one',
    order.join(',') === 'ledger,C--Users-owner-Desktop',
    order.join(' then '),
  );
}

async function refreshChecks(page, report, core) {
  await page.locator('[data-spend-refresh]').click();
  const again = await waitFor(() => countReads(core) === 2);
  report.check('refresh asks again — the button is the only re-read there is', again);

  core.spendDown = true;
  await page.locator('[data-spend-refresh]').click();
  const failed = await waitFor(async () => (await page.locator('.spend-failed').count()) === 1);
  const kept = (await page.locator('[data-spend-week]').count()) === 8;
  report.check(
    'a refresh core does not answer says so, and keeps the last numbers on screen',
    failed && kept,
    text(await page.locator('.spend-failed').allTextContents()),
  );
  core.spendDown = false;

  await page.locator('[data-spend-refresh]').click();
  const cleared = await waitFor(async () => (await page.locator('.spend-failed').count()) === 0);
  report.check('and the warning goes once core answers again', cleared);
}
