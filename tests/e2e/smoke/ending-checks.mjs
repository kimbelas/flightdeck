// How a stopped background session ended, on its row — D62.
//
// `claude agents --json` reads `state: done` for a stop, a finish and a retirement, and a session
// the daemon retired while it was blocked keeps reading `blocked` with no `pid` (F.2.3, F.2.15).
// Core now reads the ending off `daemon.log` onto the row. The fixture has no ending on any row —
// it is a healthy machine on purpose (`adopt-checks`' rule) — so the snapshot is PUSHED, built by
// core's own `EndingBook` from log lines naming `fixture-foxtrot`, the fixture's one stopped
// background row. What is checked is the half no unit test can see: the words reaching the page,
// and the row staying what G.24 said a dead session must be — dimmed, resumable, not on top.
import { waitFor } from './report.mjs';

const STOPPED = 'fixture-foxtrot';
const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

export async function endingChecks(page, report, core) {
  report.group('How a stopped session ended, from daemon.log (D62)');

  const foxtrot = core.fixture.snapshot.rows.find((row) => row.name === STOPPED);
  if (foxtrot === undefined) {
    report.check(`the fixture has a stopped background session called ${STOPPED}`, false);
    return;
  }
  await page.locator('[data-project-all]').click();
  if (!(await waitFor(async () => (await rowFor(page).count()) === 1))) {
    report.check(`${STOPPED} is on the list`, false);
    return;
  }
  report.check(
    'with no ending read, a stopped row keeps the listing’s own word',
    (await metaOf(page)).includes('blocked'),
    await metaOf(page),
  );

  await retiredWhileWaiting(page, report, core, foxtrot);
  await stoppedByOwner(page, report, core, foxtrot);

  core.publish('snapshot', core.fixture.snapshot);
  await waitFor(async () => (await metaOf(page)).includes('blocked'));
}

/** F.2.15's `idle-prompt`: the daemon took it while it was waiting on the owner. */
async function retiredWhileWaiting(page, report, core, foxtrot) {
  const at = Date.now() - 60_000;
  const log = [
    line(at, `bg retire ${foxtrot.shortId}: idle-prompt, idle 60m`),
    line(at + 1100, `bg settled ${foxtrot.shortId} (done)`),
  ].join('\n');
  core.publish('snapshot', await core.snapshotEndedBy(STOPPED, log));

  const said = await waitFor(async () =>
    (await metaOf(page)).includes('retired while waiting for you'),
  );
  report.check(
    'a retirement while blocked says "retired while waiting for you"',
    said,
    await metaOf(page),
  );
  report.check(
    'and never "finished" — it was an unanswered request, not a completion',
    !/finish/iu.test(await metaOf(page)),
  );
  const row = rowFor(page);
  report.check(
    'it stays dimmed as ended — a dead session must not look like a live one waiting (G.24)',
    /\btone-ended\b/u.test((await row.getAttribute('class')) ?? ''),
    clean(await row.getAttribute('class')),
  );
  report.check(
    'and it still offers resume, which is what answering it means now',
    (await row.locator('button', { hasText: 'resume' }).count()) === 1,
  );
}

/** `bg settled <id> (killed)` is `claude stop` (F.2.3) — no longer "done", and no longer unknown. */
async function stoppedByOwner(page, report, core, foxtrot) {
  const log = line(Date.now() - 30_000, `bg settled ${foxtrot.shortId} (killed)`);
  core.publish('snapshot', await core.snapshotEndedBy(STOPPED, log));

  const said = await waitFor(async () => /\bstopped\b/u.test(await metaOf(page)));
  report.check('a stop says "stopped"', said, await metaOf(page));
}

function line(at, message) {
  return `[${new Date(at).toISOString()}] [bg] ${message}`;
}

function rowFor(page) {
  return page
    .locator('article.row')
    .filter({ has: page.locator('.row-toggle', { hasText: STOPPED }) })
    .first();
}

async function metaOf(page) {
  return clean(await rowFor(page).locator('.row-meta').textContent());
}
