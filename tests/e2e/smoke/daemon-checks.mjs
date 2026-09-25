// Background daemons in the installation panel — P7-T4, SPEC §6(13).
//
// What is under test is the F.2.16 sentence reaching the screen: isg's roster fixture names
// supervisor 3828, the fixture probe says that pid EXISTS, and the log saw it shut down — so the
// panel must say "not running" and name what fixes it. The fixture core answers with core's own
// `DaemonReader` over the scrubbed captures (`daemon-fixture.mjs`), so these checks read what core
// would conclude from those files rather than a hand-written verdict.
import { FIXTURE_SUPERVISOR_PID } from './daemon-fixture.mjs';
import { waitFor } from './report.mjs';

export async function daemonChecks(page, report, core) {
  report.group('Background daemons — roster, retirements, the dead supervisor (P7-T4)');
  const before = core.daemonReads;

  await page.locator('[aria-label="installation isg"]').click();
  const panel = page.locator('[data-daemon-panel]');
  report.check('the installation panel carries the daemon panel', await panel.isVisible());
  report.check(
    'and reads nothing until asked — the panel is a photograph with a button',
    core.daemonReads === before && (await page.locator('[data-daemon]').count()) === 0,
  );

  await page.locator('[data-daemon-read]').click();
  const drawn = await waitFor(async () => (await page.locator('[data-daemon]').count()) === 2);
  report.check(
    'one press, one read, and both subscriptions drawn',
    drawn && core.daemonReads === before + 1,
    `${String(core.daemonReads - before)} reads`,
  );

  await staleChecks(page, report);
  await endingChecks(page, report);

  await page.locator('[aria-label="close installation"]').click();
}

/** isg: the roster's supervisor is gone, and the panel says so and says what fixes it. */
async function staleChecks(page, report) {
  const isg = page.locator('[data-daemon="isg"]');
  const head = ((await isg.locator('.daemon-head').allTextContents())[0] ?? '(none)').trim();
  report.check(
    'isg reads stale — the log overrules a probe that says the pid exists (F.2.16)',
    (await isg.locator('[data-daemon-state="bad"]').count()) === 1 &&
      head.includes(String(FIXTURE_SUPERVISOR_PID)) &&
      head.includes('shut down'),
    head,
  );
  report.check(
    'and names the one repair that works — a --bg launch — rather than "try again"',
    head.includes('stop, rm and logs fail') && head.includes('--bg'),
    head,
  );
  const workers = (await isg.locator('[data-daemon-workers] li').allTextContents()).join(' | ');
  report.check(
    'the roster’s worker is listed, marked gone',
    workers.includes('2f3e94f3') && workers.includes('(gone)'),
    workers,
  );

  const quiet = page.locator('[data-daemon="365"] [data-daemon-state="quiet"]');
  const text = ((await quiet.allTextContents())[0] ?? '(none)').trim();
  report.check(
    '365 has no roster, so it is not running rather than stale',
    text.includes('not running') && !text.includes('roster'),
    text,
  );
}

/** How the sessions ended — the reason `agents --json` reads as `done` for all three (F.2.3). */
async function endingChecks(page, report) {
  const lines = await page
    .locator('[data-daemon="365"] [data-daemon-endings] li')
    .allTextContents();
  report.check(
    'endings are listed with the log’s reason, not the listing’s `done`',
    lines.some((line) => line.includes('stopped')) &&
      lines.some((line) => line.includes('retired')),
    lines.slice(0, 3).join(' | '),
  );

  const attention = page.locator('[data-daemon="365"] [data-daemon-ending="attention"]');
  const flagged = ((await attention.allTextContents())[0] ?? '(none)').replaceAll(/\s+/gu, ' ');
  report.check(
    'an idle-prompt retirement is drawn as waiting for you, with its ≤ idle figure',
    flagged.includes('retired while waiting for you') && flagged.includes('idle ≤'),
    flagged,
  );
  const unanswered =
    (await page.locator('[data-daemon="365"] [data-daemon-unanswered]').allTextContents())[0] ?? '';
  report.check(
    'and counted above the list, because nobody answered those sessions',
    /^\d+ retired while waiting for you/u.test(unanswered.trim()),
    unanswered,
  );

  const all = (await page.locator('[data-daemon-panel]').allTextContents()).join(' ');
  report.check(
    'nothing on the panel is a path or a prompt — GET /daemon carries neither',
    !all.includes(':\\') && !all.includes('text-'),
  );
}
