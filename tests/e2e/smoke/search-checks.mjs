// Search every transcript — P7-T2, SPEC §5.8, and the phase gate in the browser.
//
// *"Where did I do that Cloudflare Workers deploy?" returns the session in under a second.* Here
// that is measured from the last keystroke to the hit being ON SCREEN, through the real proxy, the
// real rewrite and core's own `SearchRoute` over a real FTS5 index (`fixture-search.mjs`). What no
// unit test can see: the box searches as it is typed, each filter reaches core as a parameter and
// changes what is drawn, a hit on a session the deck still lists offers that row's own verb, one it
// no longer lists offers the command back to it, and the panel says the index is still filling
// until it is not.
import { projectKey } from '../../../contracts/project.ts';
import { GONE_HIT, LIVE_HIT, NEAR_MISS, OLD_HIT } from '../fixture-search.mjs';
import { LEDGER } from './project-view-checks.mjs';
import { pause, waitFor } from './report.mjs';

const GATE = 'cloudflare workers deploy';
const clean = (text) => (text ?? '').replaceAll(/\s+/gu, ' ').trim();
const short = (id) => id.slice(0, 8);

export async function searchChecks(page, report, core) {
  report.group('Search — every transcript (P7-T2)');
  if (!(await readyChecks(page, report, core))) return;
  await gateChecks(page, report, core);
  await hitChecks(page, report);
  await filterChecks(page, report, core);
  await caughtUpChecks(page, report, core);
  await page.fill('#transcript-search', '');
}

/**
 * The panel on a deck that has ledger imported, and the sentence about the index before anything
 * is typed. Imported by the double rather than by the panel: the import path is `projectChecks`'
 * subject, and this group needs the registry in a known state wherever in the run it is placed.
 */
async function readyChecks(page, report, core) {
  core.projects.set(projectKey(LEDGER), { path: LEDGER, name: 'ledger', importedAt: Date.now() });
  await page.reload();
  const ready = await waitFor(
    async () => (await page.locator('#transcript-search').count()) === 1,
    {
      timeout: 20_000,
    },
  );
  report.check('the search box is on the deck', ready);
  if (!ready) return false;
  const index = page.locator('.search-index');
  // On the text, not on the element: until the empty search's reply lands the line reads
  // "progress unknown", so an element-count wait raced it and failed one run in two.
  const said = await waitFor(async () =>
    (await index.count()) === 1
      ? clean(await index.textContent()).includes('300 MB of 800 MB read')
      : false,
  );
  report.check(
    'before anything is typed it says the index is still filling, and how far it has got',
    said,
    clean(await index.textContent().catch(() => '')),
  );
  await page.locator('main.deck').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+k');
  await waitFor(async () => (await page.locator('.palette-input').count()) > 0);
  await page.locator('.palette-input').fill('search every transcript');
  await page.keyboard.press('Enter');
  const focused = await waitFor(() =>
    page.evaluate(() => document.activeElement?.id === 'transcript-search'),
  );
  report.check('the palette’s "Search every transcript" puts the caret in the box', focused);
  return true;
}

/** The gate: the words of the question, typed, and the sessions on screen in under a second. */
async function gateChecks(page, report, core) {
  const asked = core.search.asked.length;
  const started = Date.now();
  await page.fill('#transcript-search', GATE);
  const shown = await waitFor(async () => (await page.locator('.search-hit').count()) === 3, {
    every: 10,
  });
  const took = Date.now() - started;
  report.check(
    'typing the gate’s words shows the matching sessions in under a second',
    shown && took < 1000,
    `${String(took)} ms`,
  );
  const sessions = await page.locator('.search-hit').evaluateAll((all) => all.map((hit) => hit.dataset.session)); // prettier-ignore
  report.check(
    'one hit per session, and the one that only says "cloudflare" is not among them',
    [LIVE_HIT, GONE_HIT, OLD_HIT].every((id) => sessions.includes(short(id))) &&
      !sessions.includes(short(NEAR_MISS)),
    sessions.join(' '),
  );
  report.check(
    'a word being typed is one request, not one per keystroke',
    core.search.asked.length - asked <= 2,
    `${String(core.search.asked.length - asked)} requests`,
  );
  const summary = clean(await page.locator('.search-summary').textContent());
  report.check('the summary says how many and how fast', /^3 sessions · \d+ ms$/u.test(summary), summary); // prettier-ignore
}

/** What each kind of hit offers. */
async function hitChecks(page, report) {
  const live = page.locator(`.search-hit[data-session="${short(LIVE_HIT)}"]`);
  report.check(
    'a hit on a session the deck lists offers that row’s own open pane',
    (await live.locator('.search-hit-open').count()) === 1 &&
      (await live.locator('.search-hit-resume').count()) === 0,
  );
  const gone = page.locator(`.search-hit[data-session="${short(GONE_HIT)}"]`);
  const resume = clean(
    await gone
      .locator('.search-hit-resume')
      .textContent()
      .catch(() => ''),
  );
  report.check(
    'a hit on a session the deck no longer lists offers the resume command, in its folder',
    resume === `cd "${LEDGER}"; claude-365 --resume ${GONE_HIT}`,
    resume,
  );
  report.check(
    'and names the imported project rather than the slug',
    clean(await gone.locator('.search-hit-project').textContent()) === 'ledger',
  );
  const old = page.locator(`.search-hit[data-session="${short(OLD_HIT)}"]`);
  const oldResume = clean(
    await old
      .locator('.search-hit-resume')
      .textContent()
      .catch(() => ''),
  );
  report.check(
    'a worktree hit in a folder nobody imported gets no cd it cannot know',
    oldResume === `claude-isg --resume ${OLD_HIT}`,
    oldResume,
  );
}

/** Each filter reaches core as a parameter and narrows what is drawn; a hit sets the session one. */
async function filterChecks(page, report, core) {
  await pick(page, core, '.search-filter-subscription', 'isg');
  report.check(
    'the account filter reaches core and leaves the isg session alone',
    core.search.asked.at(-1)?.includes('subscription=isg') === true &&
      (await drawn(page)).join(' ') === short(OLD_HIT),
    (await drawn(page)).join(' '),
  );
  await pick(page, core, '.search-filter-subscription', '');
  await pick(page, core, '.search-filter-range', 'older');
  report.check(
    '"older than 30 days" finds the session cleanup has already deleted from disk',
    core.search.asked.at(-1)?.includes('until=') === true &&
      (await drawn(page)).join(' ') === short(OLD_HIT),
    (await drawn(page)).join(' '),
  );
  await pick(page, core, '.search-filter-range', 'any');
  await pick(page, core, '.search-filter-tool', 'WebFetch');
  report.check(
    'the tool filter offers what the index holds and narrows to the session that called it',
    (await drawn(page)).join(' ') === short(OLD_HIT),
    (await drawn(page)).join(' '),
  );
  await pick(page, core, '.search-filter-tool', '');
  await pick(page, core, '.search-filter-project', 'C--Users-owner-Documents-ledger');
  report.check(
    'the project filter sends the folder’s slug and keeps its two sessions',
    (await drawn(page)).sort().join(' ') === [short(GONE_HIT), short(LIVE_HIT)].sort().join(' '),
    (await drawn(page)).join(' '),
  );
  await page.locator(`.search-hit[data-session="${short(GONE_HIT)}"] .search-hit-only`).click();
  report.check(
    '"only this session" narrows to it, and says so',
    (await waitFor(async () => (await drawn(page)).join(' ') === short(GONE_HIT))) &&
      clean(await page.locator('.search-filter-session').textContent()).includes(short(GONE_HIT)),
  );
  await page.locator('.search-clear').click();
  report.check(
    'clear filters brings every session back',
    await waitFor(async () => (await page.locator('.search-hit').count()) === 3),
  );
}

/** Once every cursor has reached its file, the sentence goes. */
async function caughtUpChecks(page, report, core) {
  core.search.caughtUp();
  await page.fill('#transcript-search', `${GATE} `);
  report.check(
    'the filling sentence goes once the index has caught up',
    await waitFor(async () => (await page.locator('.search-index').count()) === 0),
  );
}

async function pick(page, core, selector, value) {
  const asked = core.search.asked.length;
  await page.locator(selector).selectOption(value);
  // A filter searches at once: wait for core to be asked, then for the reply to be drawn.
  await waitFor(() => core.search.asked.length > asked);
  await pause(150);
}

async function drawn(page) {
  return page.locator('.search-hit').evaluateAll((all) => all.map((hit) => hit.dataset.session));
}
