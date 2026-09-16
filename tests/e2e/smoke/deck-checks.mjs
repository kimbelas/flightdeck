// What the deck draws, and what it does when the stream says something changed.
//
// The first check in this file is the one the task exists for. 1290 unit tests say nothing about
// whether the deck HYDRATES — `app/**` is not in `coverage.include` and cannot be, since the store
// is tested without a DOM on purpose — and every one of the six bugs in RESEARCH.md §G was found by
// running the thing rather than by testing it. `chip-live` is the honest probe: it turns green only
// after `DeckStore` has opened an `EventSource`, received a `snapshot` frame and parsed it, and
// none of that happens on a page that rendered server-side and stopped (G.3, F.5.1).
import { waitFor } from './report.mjs';

const FIXTURE_ROWS = 7;

export async function deckChecks(page, report, core) {
  report.group('The deck, against the fixture stream');
  await renderChecks(page, report);
  await gaugeChecks(page, report);
  await expandChecks(page, report);
  await filterChecks(page, report);
  await streamChecks(page, report, core);
  await launchChecks(page, report, core);
}

async function renderChecks(page, report) {
  const live = await waitFor(async () => (await page.locator('.chip-live').count()) > 0, {
    timeout: 20_000,
  });
  report.check('the deck hydrated and the stream is live', live);

  const titles = await rowTitles(page);
  report.check(
    'every fixture row rendered',
    titles.length === FIXTURE_ROWS,
    `${titles.length} rows`,
  );
  report.check(
    'the blocked session sorts to the top (byAttentionThenAge)',
    titles[0] === 'fixture-alpha',
    titles.slice(0, 3).join(', '),
  );
  // `fixture-foxtrot` is `live: false` with `runState: 'blocked'` — the shape that took the top of
  // a real deck for five days (G.24). `runState` is the last state a session was SEEN in, so an
  // ended one keeps `blocked` forever, and sorting on it alone put a dead session above four busy
  // ones under the heading the page exists to answer. It belongs at the bottom.
  report.check(
    'a session that ended while blocked sorts to the BOTTOM, not the attention slot (G.24)',
    titles.at(-1) === 'fixture-foxtrot',
    String(titles.at(-1)),
  );
  report.check(
    'the blocked row is toned needs-you',
    (await page.locator('article.row.tone-needs-you .row-title').first().textContent()) ===
      'fixture-alpha',
  );

  const blocked = await page.locator('.row-blocked').count();
  report.check('the three unattachable rows explain why', blocked === 3, `${String(blocked)} rows`);
  report.check(
    'an interactive row gives the SPEC §5.2 reason, not a disabled button',
    ((await page.locator('.row-blocked').first().textContent()) ?? '').includes(
      'Only background sessions can be attached',
    ),
  );

  const panes = await page.locator('article.row button', { hasText: 'open pane' }).count();
  report.check('the four attachable rows offer a pane', panes === 4, `${String(panes)} buttons`);
  report.check(
    'the header counts every session',
    ((await page.locator('.deck-head').innerText()) ?? '').includes(
      `${String(FIXTURE_ROWS)} sessions`,
    ),
  );
}

/** P2-T3 — and specifically that the numbers come off the `quota` FRAME, since nothing polls. */
async function gaugeChecks(page, report) {
  const quotas = await readQuotas(page);
  const isg = quotas.find((quota) => quota.sub === 'isg');
  const three65 = quotas.find((quota) => quota.sub === '365');
  report.check('both subscriptions draw a quota block', quotas.length === 2);
  report.check(
    "isg's gauges came off the replayed quota frame",
    isg?.gauges[0]?.percent === '42%' && isg?.gauges[1]?.percent === '17%',
    JSON.stringify(isg?.gauges.map((gauge) => gauge.percent)),
  );
  report.check(
    "365's 5h gauge reads high, not merely non-empty",
    three65?.gauges[0]?.percent === '88%' && three65.gauges[0].tone.includes('gauge-warn'),
    three65?.gauges[0]?.tone,
  );
  report.check(
    'a fresh reading is not dimmed as stale',
    quotas.every((quota) => quota.gauges.every((gauge) => !gauge.stale)),
  );
  report.check(
    'the bar is drawn to the reading, not to a default',
    three65?.gauges[0]?.fill.includes('88%'),
    three65?.gauges[0]?.fill,
  );
  report.check('spend prints as money', three65?.spend === '$12.50', three65?.spend);
  report.check('the Claude Code version chip is on the block', isg?.version === '2.1.268');
}

/** P2-T4 — the row expands in place, and the detail is a REQUEST rather than a frame. */
async function expandChecks(page, report) {
  await page.locator('[data-deck-row="365:a1b2c3d4-0000-4000-8000-000000000001"]').click();
  const shown = await waitFor(async () => (await page.locator('.detail-doing').count()) > 0);
  report.check('Enter-or-click expands a row into its detail', shown);

  const detail = (await page.locator('.detail').first().innerText()) ?? '';
  report.check(
    'the doing-now line is the daemon’s `needs`, badged as such',
    detail.includes('needs you') && detail.includes('Approve the audit column rename'),
  );
  report.check('the owner’s first prompt is shown as intent', detail.includes('ledger table'));
  report.check('the vitals strip carries the context reading', detail.includes('37% ctx'));
  // The entries, not the heading. `innerText` returns RENDERED text and `.detail-recap h3` is
  // `text-transform: uppercase`, so a check on the words "while you were away" reads the CSS
  // rather than the timeline — it fails on a recap that is perfectly correct, and passes on an
  // empty one the moment someone lowercases the heading.
  const recap = await page.locator('.detail-recap li').allInnerTexts();
  report.check(
    'the recap lists the timeline, newest first',
    recap.length === 3 && recap[0].includes('Waiting on approval'),
    recap[0],
  );
  report.check(
    'transcript files are listed as text, never as links',
    detail.includes('0007-rename-audit.sql') &&
      (await page.locator('.detail-files a').count()) === 0,
  );
  report.check(
    'the sparkline is drawn from the token trail',
    (await page.locator('.detail-spark polyline').count()) === 1,
  );

  await page.locator('[data-deck-row="365:b2c3d4e5-0000-4000-8000-000000000002"]').click();
  // Not merely "a note appeared": the spinner IS a `.detail-note` reading "reading…", so waiting on
  // the element rather than the sentence would pass on the in-flight state every time.
  const bare = await waitFor(async () =>
    ((await page.locator('.detail-note').last().textContent()) ?? '').includes('has not reported'),
  );
  report.check(
    'a session that has reported nothing says so rather than showing an empty detail',
    bare,
  );

  await page.locator('[data-deck-row="365:a1b2c3d4-0000-4000-8000-000000000001"]').click();
  await page.locator('[data-deck-row="365:b2c3d4e5-0000-4000-8000-000000000002"]').click();
  const collapsed = await waitFor(
    async () => (await page.locator('.detail, .detail-note').count()) === 0,
  );
  report.check('collapsing drops the detail', collapsed);
}

/** P2-T5's `/` filter, and the empty state that distinguishes "none" from "none match". */
async function filterChecks(page, report) {
  await page.locator('#deck-search').fill('charlie');
  const narrowed = await waitFor(async () => (await page.locator('article.row').count()) === 1);
  report.check('the filter narrows the list', narrowed, (await rowTitles(page)).join(', '));

  await page.locator('#deck-search').fill('365 background');
  const both = await waitFor(async () => (await page.locator('article.row').count()) === 3);
  report.check('every term has to land, so two terms narrow rather than widen', both);

  await page.locator('#deck-search').fill('nothing-matches-this');
  const empty = await waitFor(async () =>
    ((await page.locator('.rows .muted.pad').textContent()) ?? '').includes('No session matches'),
  );
  report.check('an empty filter result says the filter hid them, not that there are none', empty);

  await page.locator('#deck-search').fill('');
  const restored = await waitFor(
    async () => (await page.locator('article.row').count()) === FIXTURE_ROWS,
  );
  report.check('clearing the box brings them all back', restored);
}

/** The deltas — the half of P1-T9 that a store unit test can assert but a browser has never. */
async function streamChecks(page, report, core) {
  core.publish('session.upsert', core.fixture.arriving);
  const arrived = await waitFor(async () => (await rowTitles(page)).includes('fixture-hotel'));
  report.check('a session.upsert frame adds a row with no fetch', arrived);

  core.publish('session.gone', core.fixture.leaving);
  const gone = await waitFor(async () => !(await rowTitles(page)).includes('fixture-golf'));
  report.check('a session.gone frame removes one', gone);

  core.publish('snapshot', { ...core.fixture.snapshot, unreadable: ['isg'] });
  const banner = await waitFor(async () =>
    (
      (await page
        .locator('.banner-bad')
        .textContent()
        .catch(() => '')) ?? ''
    ).includes('those sessions are missing, not absent'),
  );
  report.check('an unreadable subscription is banner-ed rather than shown as empty', banner);

  core.publish('snapshot', core.fixture.snapshot);
  const cleared = await waitFor(async () => (await page.locator('.banner-bad').count()) === 0);
  report.check('a readable sweep clears the banner', cleared);
}

/** The one control on the deck that creates something, and what core actually received. */
async function launchChecks(page, report, core) {
  await page.locator('[aria-label="subscription"]').selectOption('isg');
  await page.locator('[aria-label="session name"]').fill('smoke-launch');
  await page.locator('#launch-prompt').fill('summarise the ledger migration');
  await page.locator('button', { hasText: 'start background session' }).click();

  const received = await waitFor(() => core.launches.length === 1);
  report.check('the launch form reaches core', received, JSON.stringify(core.launches[0] ?? {}));
  report.check(
    'it carries the chosen subscription, prompt and name',
    core.launches[0]?.subscription === 'isg' &&
      core.launches[0]?.prompt === 'summarise the ledger migration' &&
      core.launches[0]?.name === 'smoke-launch',
  );
  const emptied = await waitFor(
    async () => (await page.locator('#launch-prompt').inputValue()) === '',
  );
  report.check('an accepted launch clears the prompt', emptied);

  const before = core.requests.filter((request) => request.path === '/sessions').length;
  await page.locator('.deck-head button', { hasText: 'refresh' }).click();
  const swept = await waitFor(
    () => core.requests.filter((request) => request.path === '/sessions').length > before,
  );
  report.check('refresh forces a sweep through the rewrite', swept);
}

function rowTitles(page) {
  return page.$$eval('article.row .row-title', (nodes) => nodes.map((node) => node.textContent));
}

function readQuotas(page) {
  return page.$$eval('.quota', (blocks) =>
    blocks.map((block) => ({
      sub: block.querySelector('.quota-sub')?.textContent ?? '',
      spend: block.querySelector('.quota-spend')?.textContent ?? '',
      version: block.querySelector('.chip-version')?.textContent ?? '',
      gauges: [...block.querySelectorAll('.gauge')].map((gauge) => ({
        percent: gauge.querySelector('.gauge-percent')?.textContent ?? '',
        tone: gauge.className,
        stale: gauge.classList.contains('gauge-stale'),
        fill: gauge.querySelector('.gauge-fill')?.getAttribute('style') ?? '',
      })),
    })),
  );
}
