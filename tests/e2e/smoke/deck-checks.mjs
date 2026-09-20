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
  await previewChecks(page, report, core);
  await filterChecks(page, report);
  await streamChecks(page, report, core);
  await launchChecks(page, report, core);
  await resumeChecks(page, report, core);
  await stopChecks(page, report, core);
}

/**
 * The other half of the lifecycle - P4-T2b.
 *
 * `fixture-alpha` is a live background row, so it is the one that can be stopped; the stopped row
 * offers resume instead and the interactive rows offer neither. What matters on the wire is that
 * BOTH ids go over: `stop` takes the SHORT one (RESEARCH.md F.2.8b) and the deck does not derive
 * it, so a row that sent only the uuid is a row core refuses.
 */
async function stopChecks(page, report, core) {
  const live = page.locator('article.row', { hasText: 'fixture-alpha' });
  const button = live.locator('button', { hasText: 'stop' });
  report.check(
    'a live background row offers stop beside its pane button',
    (await button.count()) === 1 &&
      (await live.locator('button', { hasText: 'open pane' }).count()) === 1,
  );

  const stopped = page.locator('article.row', { hasText: 'fixture-foxtrot' });
  const interactive = page.locator('article.row', { hasText: 'fixture-delta' });
  report.check(
    'and neither a stopped nor an interactive row does',
    (await stopped.locator('button', { hasText: 'stop' }).count()) === 0 &&
      (await interactive.locator('button', { hasText: 'stop' }).count()) === 0,
  );

  const before = core.stops.length;
  await button.click();
  const sent = await waitFor(async () => core.stops.length > before);
  const last = core.stops.at(-1);
  report.check('clicking it reaches core', sent, JSON.stringify(last ?? {}));
  report.check(
    'with BOTH ids - the short one is what the CLI takes (F.2.8b)',
    last?.shortId === 'a1b2c3d4' && last.sessionId === 'a1b2c3d4-0000-4000-8000-000000000001',
    JSON.stringify(last ?? {}),
  );
  report.check(
    'and no error banner for a stop core accepted',
    (await page.locator('.banner-bad').count()) === 0,
  );
}

/**
 * The row that says "not running" now has a button - P4-T2a.
 *
 * `fixture-foxtrot` is the only background row in the fixture that is not live, which makes it the
 * only resumable one. The three assertions are the three halves of the feature that can be got
 * wrong independently: that the button is offered on exactly the right rows, that it sends the FULL
 * uuid (a short one forks a copy of the session - RESEARCH.md F.2.7), and that the sentence
 * explaining why there is no pane is still there beside it.
 */
async function resumeChecks(page, report, core) {
  const resumable = page.locator('article.row', { hasText: 'fixture-foxtrot' });
  const button = resumable.locator('button', { hasText: 'resume' });
  report.check(
    'the stopped background row offers resume',
    (await button.count()) === 1,
    `${String(await button.count())} button(s)`,
  );

  // A live background row has a pane instead, and an interactive one has neither - the sentence
  // it carries is permanent (SPEC 5.2). Offering resume on either would be the bug.
  const live = page.locator('article.row', { hasText: 'fixture-alpha' });
  const interactive = page.locator('article.row', { hasText: 'fixture-delta' });
  report.check(
    'and no live or interactive row does',
    (await live.locator('button', { hasText: 'resume' }).count()) === 0 &&
      (await interactive.locator('button', { hasText: 'resume' }).count()) === 0,
  );

  report.check(
    'the row still says why it has no pane',
    (await resumable.locator('.row-blocked').innerText()).includes('Resume it to attach'),
    await resumable.locator('.row-blocked').innerText(),
  );

  const before = core.resumes.length;
  await button.click();
  const sent = await waitFor(async () => core.resumes.length > before);
  const last = core.resumes.at(-1);
  report.check('clicking it reaches core', sent, JSON.stringify(last ?? {}));
  report.check(
    'with the FULL lowercase session uuid, which is what stops it forking a copy (F.2.7)',
    last?.sessionId === 'f6a7b8c9-0000-4000-8000-000000000006' && last.subscription === '365',
    JSON.stringify(last ?? {}),
  );
  report.check(
    'and the deck showed no error for a resume core accepted',
    (await page.locator('.banner-bad').count()) === 0,
  );
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

/**
 * P5a-T4 — the preview, which is a button and never a timer.
 *
 * The three assertions that matter are about restraint as much as about rendering. Expanding a row
 * must NOT read a preview: one costs a 2.7 s spawn and 330 KB of terminal frame (RESEARCH.md
 * F.2.5, "never poll it"), and a deck that fetched one on every expansion would be doing exactly
 * what that measurement forbids. Pressing must read. Pressing again must read AGAIN, because a
 * preview is a photograph and the button is the only refresh there is.
 */
async function previewChecks(page, report, core) {
  const alpha = '365:a1b2c3d4-0000-4000-8000-000000000001';
  const before = core.previewed.length;
  await page.locator(`[data-deck-row="${alpha}"]`).click();
  await waitFor(async () => (await page.locator('.detail-doing').count()) > 0);
  report.check(
    'expanding a row does NOT read a preview — F.2.5 says never poll it',
    core.previewed.length === before,
    `${String(core.previewed.length - before)} read(s)`,
  );

  const row = page.locator('article.row', { hasText: 'fixture-alpha' });
  const button = row.locator('[data-deck-preview-read]');
  report.check('an expanded row offers to read one', (await button.count()) === 1);
  const narrow = (await page.locator('.deck-left').boundingBox())?.width ?? 0;

  await button.click();
  const read = await waitFor(async () => (await row.locator('pre.preview-screen').count()) === 1);
  report.check('pressing it draws the screen core replayed', read);

  const screen = (await row.locator('pre.preview-screen').innerText()) ?? '';
  report.check(
    'the screen is the terminal’s own text, box drawing and all',
    screen.includes('Claude Code v2.1.268') && screen.includes('─') && screen.includes('█'),
  );
  report.check(
    'no escape sequence survives into the page (SEC-UI-2)',
    !screen.includes('\u001b') && !screen.includes('[38;2;'),
  );
  // GEOMETRY, not a class name: a screen is 200 columns of aligned chrome and `white-space: pre`
  // is what keeps it aligned. If the rule were dropped the box rule would wrap and the block would
  // grow taller than the line count can explain, so the two are compared.
  const box = await row.locator('pre.preview-screen').boundingBox();
  const lines = screen.split('\n').length;
  report.check(
    'the screen is not re-wrapped — it scrolls sideways instead',
    box !== null && box.height < lines * 30,
    `${String(Math.round(box?.height ?? 0))}px for ${String(lines)} lines`,
  );
  report.check(
    'the blank band a fixed-height frame leaves is condensed away',
    !screen.includes('\n\n\n'),
  );
  report.check(
    'the preview says how old it is',
    (await row.locator('.detail-preview-head .muted').count()) === 1,
  );

  // GEOMETRY again, and this one measures the CSS rule rather than the markup: a 200-column screen
  // read through a 340px column is forty-seven characters, so the left column widens while a
  // preview is open. Deleting the `:has()` rule fails here.
  const wide = (await page.locator('.deck-left').boundingBox())?.width ?? 0;
  report.check(
    'the session column makes room while a preview is open',
    wide > narrow + 100,
    `${String(Math.round(narrow))}px -> ${String(Math.round(wide))}px`,
  );

  const asked = core.previewed.length;
  await row.locator('[data-deck-preview-read]').click();
  const again = await waitFor(async () => core.previewed.length > asked);
  report.check('pressing again reads again — the button IS the refresh', again);

  // The other KIND of answer. An interactive session can never be attached (SPEC §5.2), which is
  // the case a preview exists for, and what it gets is a trail rather than a screen.
  await page.locator('[data-deck-row="365:d4e5f6a7-0000-4000-8000-000000000004"]').click();
  const delta = page.locator('article.row', { hasText: 'fixture-delta' });
  await delta.locator('[data-deck-preview-read]').click();
  const trail = await waitFor(async () => (await delta.locator('pre.preview-trail').count()) === 1);
  report.check('a session with no screen gets the transcript trail instead', trail);
  const note = (await delta.locator('.detail-preview').innerText()) ?? '';
  report.check(
    'and is told why, in the deck’s words rather than core’s code',
    note.includes('background service is not running') && !note.includes('daemon_down'),
  );
  // `textContent`, not `innerText`. The heading is `text-transform: uppercase`, so `innerText`
  // returns what the CSS made of it — a check on the words would be reading the stylesheet, which
  // is the mistake `expandChecks` records having made about the recap heading.
  const heading = (await delta.locator('.detail-preview h3').textContent()) ?? '';
  report.check(
    'the trail is labelled as a trail, not as a screen',
    heading === 'recent activity',
    heading,
  );

  await page.locator(`[data-deck-row="${alpha}"]`).click();
  await page.locator('[data-deck-row="365:d4e5f6a7-0000-4000-8000-000000000004"]').click();
  const gone = await waitFor(async () => (await page.locator('.detail-preview').count()) === 0);
  report.check('collapsing drops the preview with the detail', gone);
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
