// What the deck draws, and what it does when the stream says something changed.
//
// The first check in this file is the one the task exists for. 1290 unit tests say nothing about
// whether the deck HYDRATES — `app/**` is not in `coverage.include` and cannot be, since the store
// is tested without a DOM on purpose — and every one of the six bugs in RESEARCH.md §G was found by
// running the thing rather than by testing it. `chip-live` is the honest probe: it turns green only
// after `DeckStore` has opened an `EventSource`, received a `snapshot` frame and parsed it, and
// none of that happens on a page that rendered server-side and stopped (G.3, F.5.1).
import { pause, waitFor } from './report.mjs';

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
  await deleteChecks(page, report, core);
}

/**
 * The one control that destroys something — P4-T2.
 *
 * Four properties, and every one of them is a thing a "tidy-up" could take away without a unit
 * test noticing:
 *
 *  - it is NOT on a collapsed row, so a row you scroll past has no delete button on it;
 *  - it is NOT in `.row-actions`, where `stop` lives — the roadmap task says in as many words that
 *    it must not arrive behind a button that looks like `stop`;
 *  - the first press sends NOTHING, and the sentence that appears says what will be lost;
 *  - cancel leaves core untouched.
 *
 * `fixture-alpha` is a live background row, which is the case F.2.8 measured: `rm` deletes a
 * running session as readily as a stopped one.
 */
/** Presses a button if the build under test drew one. See the `allTextContents` note below. */
async function clickIfPresent(root, label) {
  const button = root.locator('button', { hasText: label });
  if ((await button.count()) > 0) await button.first().click();
}

async function deleteChecks(page, report, core) {
  const key = '365:a1b2c3d4-0000-4000-8000-000000000001';
  const row = page.locator('article.row', { hasText: 'fixture-alpha' });
  const interactive = page.locator('article.row', { hasText: 'fixture-delta' });

  report.check(
    'a collapsed row offers no way to delete anything',
    (await row.locator('.row-delete').count()) === 0,
  );

  await page.locator(`[data-deck-row="${key}"]`).click();
  const armed = await waitFor(async () => (await row.locator('.row-delete').count()) === 1);
  report.check('expanding it is the first of the three acts', armed);

  // Geometry, not a class name: the delete control is BELOW the row's lifecycle buttons, which is
  // what keeps a hand that reaches for `stop` away from it.
  const actions = await row.locator('.row-actions').boundingBox();
  const danger = await row.locator('.row-delete').boundingBox();
  report.check(
    'it sits below the row’s stop button rather than beside it',
    danger.y > actions.y + actions.height,
    `${String(Math.round(danger.y))} > ${String(Math.round(actions.y + actions.height))}`,
  );

  const before = core.removals.length;
  await row.locator('button', { hasText: 'delete…' }).click();
  const warned = await waitFor(
    async () => (await row.locator('.row-delete-warning').count()) === 1,
  );
  report.check('the first press arms it rather than doing it', warned);
  report.check('and nothing reached core', core.removals.length === before);

  // `allTextContents` rather than `textContent`: the second throws when the element is not there,
  // and a sabotage that skips the arming step would crash the run instead of failing this check
  // and the thirty after it (the runner's whole reason for recording rather than throwing).
  const warning = (await row.locator('.row-delete-warning').allTextContents()).join(' ');
  report.check(
    'the warning says this one is running, and that nothing brings it back',
    warning.includes('running') && warning.includes('no resume'),
    warning,
  );

  await clickIfPresent(row, 'cancel');
  const stood = await waitFor(async () => (await row.locator('.row-delete-warning').count()) === 0);
  report.check(
    'cancel puts it away, with core still untouched',
    stood && core.removals.length === before,
  );

  await clickIfPresent(row, 'delete…');
  await clickIfPresent(row, 'delete fixture-alpha');
  const sent = await waitFor(() => core.removals.length > before);
  const last = core.removals.at(-1);
  report.check('the second press is the one that reaches core', sent, JSON.stringify(last ?? {}));
  report.check(
    'with BOTH ids — `rm` takes the SHORT one, as `stop` does (F.8.4)',
    last?.shortId === 'a1b2c3d4' && last.sessionId === 'a1b2c3d4-0000-4000-8000-000000000001',
    JSON.stringify(last ?? {}),
  );
  report.check(
    'and the row is still on screen, because the reconciler has not said it is gone',
    (await row.count()) === 1,
  );

  await page.locator('[data-deck-row="365:d4e5f6a7-0000-4000-8000-000000000004"]').click();
  const none = await waitFor(async () => (await interactive.locator('.row-delete').count()) === 0);
  report.check('an interactive session offers no delete — it is not core’s to delete', none);
  await page.locator('[data-deck-row="365:d4e5f6a7-0000-4000-8000-000000000004"]').click();
  await page.locator(`[data-deck-row="${key}"]`).click();
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

/**
 * The one control on the deck that creates something, and what core actually received.
 *
 * **P4-T2 changed what it sends**: a PROFILE FUNCTION rather than a subscription, because the
 * function is the account and the model (D44), and a name that is now required (SPEC §5.7). Both
 * are asserted against what core received rather than against the form, because the form agreeing
 * with itself is not the thing that can break.
 */
async function launchChecks(page, report, core) {
  await routingChecks(page, report, core);
  await launchGateChecks(page, report, core);

  await page.locator('[aria-label="profile function"]').selectOption('claude-isg-ticket');
  await page.locator('[aria-label="session name"]').fill('smoke-launch');
  await page.locator('#launch-prompt').fill('summarise the ledger migration');
  await page.locator('button', { hasText: 'start background session' }).click();

  const received = await waitFor(() => core.launches.length === 1);
  report.check('the launch form reaches core', received, JSON.stringify(core.launches[0] ?? {}));
  report.check(
    'it carries the chosen profile function, prompt and name',
    core.launches[0]?.profileFn === 'claude-isg-ticket' &&
      core.launches[0]?.prompt === 'summarise the ledger migration' &&
      core.launches[0]?.name === 'smoke-launch',
  );
  report.check(
    'and no subscription, which the function already decides',
    core.launches[0]?.subscription === undefined,
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

/**
 * The quota-aware picker — P4-T3, SPEC §5.2.
 *
 * Three properties, and the middle one is the whole task. The fixture has `isg` bound by its 5h
 * window at 42 % (58 % free) and `365` bound by its 5h at 88 % (12 % free), so the recommendation
 * is `claude-isg` and the form must open on it rather than on the `claude-365` it defaults to.
 *
 * **The override check is the one a unit test cannot reach.** A `quota` frame arrives on every
 * statusLine render. The bug this guards against is an effect that pushes the recommendation into
 * the select: the owner picks `claude-365`, keeps typing their prompt, a frame lands, and the
 * launch goes to the other account. So a frame is published AFTER the override with different
 * numbers in it, the check waits for the hint to prove that frame was applied, and only then reads
 * the select. Asserting the select alone would pass against a form that never saw the frame.
 *
 * Every read goes through `allTextContents()`, which answers `[]` for an absent element, rather
 * than `textContent()`, which throws and takes the rest of the run with it (G.40).
 */
async function routingChecks(page, report, core) {
  const picker = page.locator('[aria-label="profile function"]');
  const hint = page.locator('[aria-label="quota recommendation"]');

  const opened = await waitFor(async () => (await picker.inputValue()) === 'claude-isg');
  report.check(
    'the picker opens on the account with the most headroom, not on the default',
    opened,
    `select = ${await picker.inputValue()}`,
  );
  const sentence = (await hint.allTextContents())[0] ?? '';
  report.check(
    'and the advice names both figures and the window it judged on',
    sentence.includes('isg 58% free (5h)') && sentence.includes('365 12% free (5h)'),
    sentence,
  );
  // The check that caught the one real bug in this task. The select and the hint are derived from
  // the same recommendation, and the first version asked the hint about the untouched DEFAULT
  // while the select already showed the RECOMMENDED one — so a form nobody had touched reported
  // itself as overridden and drew its advice in the warning colour.
  report.check(
    'a form nobody has touched does not claim to have been overridden',
    sentence.includes('most headroom') &&
      !((await hint.getAttribute('class')) ?? '').includes('quota-hint-overridden'),
    sentence,
  );

  await picker.selectOption('claude-365');
  core.publish('quota', emptierIsg(core.fixture.quota));
  const applied = await waitFor(async () =>
    ((await hint.allTextContents())[0] ?? '').includes('95% free'),
  );
  report.check('a later quota frame reaches the form', applied);
  report.check(
    'and it does NOT move a picker the owner has already set — the override is permanent',
    (await picker.inputValue()) === 'claude-365',
    `select = ${await picker.inputValue()}`,
  );
  report.check(
    'the hint marks the override rather than hiding the recommendation',
    ((await hint.getAttribute('class')) ?? '').includes('quota-hint-overridden'),
  );

  await picker.selectOption('claude-isg-ticket');
  const pinned = await waitFor(async () =>
    ((await hint.allTextContents())[0] ?? '').includes('isg by construction'),
  );
  report.check(
    'a function that is isg by construction is told so, not offered a swap (D44)',
    pinned,
  );
  report.check(
    'and no headroom figures are printed beside a swap that cannot be made',
    !((await hint.allTextContents())[0] ?? '').includes('% free'),
  );

  core.publish('quota', core.fixture.quota);
  await picker.selectOption('claude-365');
}

/** The fixture's quota with `isg` almost empty, so a re-applied recommendation would be visible. */
function emptierIsg(quota) {
  return {
    ...quota,
    subscriptions: quota.subscriptions.map((entry) =>
      entry.subscription === 'isg'
        ? {
            ...entry,
            fiveHour: { ...entry.fiveHour, usedPercentage: 5 },
            sevenDay: { ...entry.sevenDay, usedPercentage: 5 },
          }
        : entry,
    ),
  };
}

/**
 * What the form will not let you do — P4-T2's forced naming, and the one exception to it.
 *
 * Asserted on the BUTTON and on what core received, rather than on the field: "a name is
 * required" is only true if nothing leaves the page without one.
 */
async function launchGateChecks(page, report, core) {
  const start = page.locator('button', { hasText: 'start background session' });
  await page.locator('#launch-prompt').fill('a prompt with no name beside it');
  report.check(
    'a prompt with no name cannot be started — D7’s `unnamed`, answered',
    await start.isDisabled(),
  );

  await page.locator('[aria-label="profile function"]').selectOption('claude-isg-orch');
  const freed = await waitFor(async () => !(await start.isDisabled()));
  // `claude-isg-orch` passes `-n orchestrator`, so asking for a second name would be asking for
  // one that is thrown away (`pinsSessionName`).
  report.check('except for the function that names itself, which needs none', freed);
  report.check(
    'and its name box says so rather than sitting there empty',
    await page.locator('[aria-label="session name"]').isDisabled(),
  );

  await page.locator('[aria-label="profile function"]').selectOption('claude-365');
  const locked = await waitFor(async () => await start.isDisabled());
  report.check('choosing a function that does not name itself locks it again', locked);
  report.check('and nothing reached core while it was refusing', core.launches.length === 0);
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

/**
 * Ask — one headless question, streamed into the panel (P4-T4, D47, D48).
 *
 * Four properties, and the first two are the task:
 *
 *  - the answer arrives on the STREAM, not in the POST's body (D48) — so the check publishes
 *    records through the fixture's stream and watches the panel fill, which a deck that read the
 *    response body could not pass;
 *  - the panel prints the permission mode the run REPORTED, not the one the dropdown was set to
 *    (D47) — a panel that echoed the request back would look identical on the day the control
 *    stopped working, which is the day it matters;
 *  - the deltas build the answer and the complete `text` block that follows does NOT double it;
 *  - `busy` reads as a sentence rather than as a dead button.
 */
export async function askChecks(page, report, core) {
  report.group('Ask — a headless question, answered on the stream');
  const panel = page.locator('section.ask');
  const prompt = panel.locator('[aria-label="ask prompt"]');
  const button = panel.locator('button', { hasText: 'ask' });

  report.check(
    'the panel offers a permission mode, and never the one SEC-PROC-4 forbids',
    (await panel.locator('[aria-label="ask permission mode"] option').allTextContents()).join(
      ' ',
    ) === 'plan default acceptEdits',
    (await panel.locator('[aria-label="ask permission mode"] option').allTextContents()).join(' '),
  );

  await prompt.fill('what changed in this repo today');
  await button.first().click();
  const sent = await waitFor(() => core.asks.length === 1);
  report.check('asking reaches core', sent, JSON.stringify(core.asks[0] ?? {}));
  report.check(
    'it carries a budget cap and a turn cap — SEC-PROC-4, on the wire',
    typeof core.asks[0]?.budgetUsd === 'number' && typeof core.asks[0]?.maxTurns === 'number',
    JSON.stringify(core.asks[0] ?? {}),
  );
  report.check(
    'and a permission mode that is not bypassPermissions',
    core.asks[0]?.permissionMode === 'plan',
  );

  // D48: nothing has been answered yet, and the panel is already open on the run.
  //
  // **Re-published on every poll, and that is D48's own consequence rather than a fudge.** `ask`
  // frames are deliberately NOT replayed on connect, so a subscriber that is momentarily absent
  // misses the record outright — which is correct for a conversation and is exactly what happened
  // on the `next dev` runner, where the stream had not finished re-establishing when the first
  // publish went out: the check timed out after ten seconds and the delta that followed rendered
  // twenty milliseconds later. What this check is about is that a `started` record PRINTS the mode,
  // not that the first publish is never lost, so it keeps offering one until the panel has had it.
  // A deck that ignored the record would still fail, which is the property that matters.
  const started = {
    kind: 'started',
    sessionId: '7877f4f3-b48e-4db9-8baf-c8aa97428e7c',
    model: 'claude-opus-5',
    permissionMode: 'plan',
  };
  const opened = await waitFor(async () => {
    core.publishAsk(started);
    return ((await panel.locator('[aria-label="ask meta"]').allTextContents())[0] ?? '').includes(
      'plan',
    );
  });
  report.check('the run reports what it was allowed to do, and the panel prints it', opened);

  core.publishAsk({ kind: 'delta', text: 'Three files ' });
  core.publishAsk({ kind: 'delta', text: 'changed.' });
  const streamed = await waitFor(async () =>
    ((await panel.locator('[aria-label="ask answer"]').allTextContents())[0] ?? '').includes(
      'Three files changed.',
    ),
  );
  report.check('the answer fills from the deltas while the run is still going', streamed);

  // The complete block the CLI sends after the deltas carries the SAME sentence. Appending it
  // would print every answer twice, which is invisible until an answer is long enough to notice.
  core.publishAsk({ kind: 'text', text: 'Three files changed.' });
  await pause(150);
  const answer = (await panel.locator('[aria-label="ask answer"]').allTextContents())[0] ?? '';
  report.check(
    'and the complete block that follows does not print it a second time',
    answer.split('Three files changed.').length - 1 === 1,
    answer,
  );

  core.publishAsk({
    kind: 'done',
    ok: true,
    costUsd: 0.0135,
    durationMs: 1600,
    stopReason: 'end_turn',
  });
  const finished = await waitFor(async () =>
    ((await panel.locator('[aria-label="ask meta"]').allTextContents())[0] ?? '').includes(
      '$0.0135',
    ),
  );
  report.check('a finished run shows what it cost', finished);

  await prompt.fill('a second question while the first is running');
  core.askRunId = 'ask-held';
  await button.first().click();
  const refused = await waitFor(async () =>
    ((await panel.locator('[aria-label="ask refusal"]').allTextContents())[0] ?? '').includes(
      'One question at a time',
    ),
  );
  report.check('a second run while one is open says so rather than doing nothing', refused);
  core.askRunId = undefined;
}

/**
 * The version chip and what it opens — P4-T5.
 *
 * Four properties, and three of them are measurements rather than preferences:
 *
 *  - the chip is a BUTTON now, not the label P2-T3 left;
 *  - the panel never draws a filesystem path, because `claude doctor` prints one with the Windows
 *    account name in it and core drops it before it leaves (SEC-DATA-2, F.10.1);
 *  - the panel SAYS auto-updates are on, so the update button reads as a check rather than a chore;
 *  - a respawn reports the ids the CLI named — `--all` skips a session that has finished (F.10.4),
 *    so "all sessions restarted" would be a sentence the CLI never earned.
 */
export async function installChecks(page, report, core) {
  report.group('The version chip — doctor, updates, respawn (P4-T5)');
  const chip = page.locator('[aria-label="installation 365"]');

  report.check(
    'the version chip is a button, not the label it used to be',
    (await chip.count()) === 1 && (await chip.evaluate((node) => node.tagName)) === 'BUTTON',
  );

  const before = core.doctorReads;
  await chip.click();
  const opened = await waitFor(() => core.doctorReads > before);
  report.check('pressing it opens the panel and takes a reading', opened);

  const panel = page.locator('section.install');
  const fields = await waitFor(async () => (await panel.locator('.install-field').count()) > 0);
  report.check('the panel draws the fields doctor reported', fields);

  // The SEC-DATA-2 assertion, made on what is RENDERED rather than on what was sent.
  const text = (await panel.allTextContents()).join(' ');
  report.check(
    'and no filesystem path — doctor prints one with the account name in it (F.10.1)',
    !/[A-Za-z]:\\/u.test(text) && !text.includes('AppData'),
  );
  report.check(
    'it says auto-updates are on, so the update button reads as a check rather than a chore',
    text.includes('Auto-updates are on'),
    text.includes('Auto-updates are on') ? '' : text.slice(0, 160),
  );

  const updatesBefore = core.updates.length;
  await panel.locator('button', { hasText: 'check for updates' }).first().click();
  const checked = await waitFor(() => core.updates.length > updatesBefore);
  report.check('the update button reaches core', checked);
  const said = await waitFor(async () =>
    ((await panel.locator('[aria-label="update result"]').allTextContents())[0] ?? '').includes(
      'already up to date',
    ),
  );
  report.check('and reports the ordinary answer rather than implying something happened', said);

  await panel.locator('button', { hasText: 'respawn background sessions' }).first().click();
  const restarted = await waitFor(
    async () =>
      ((await panel.locator('[aria-label="respawn result"]').allTextContents())[0] ?? '') !== '',
  );
  const sentence =
    (await panel.locator('[aria-label="respawn result"]').allTextContents())[0] ?? '';
  report.check('a respawn reaches core', restarted && core.respawns.length === 1);
  report.check(
    'and names the ids the CLI restarted rather than claiming it restarted all of them',
    sentence.includes('d1b2f43c') && !sentence.includes('all sessions'),
    sentence,
  );

  await panel.locator('[aria-label="close installation"]').click();
  const closed = await waitFor(async () => (await panel.count()) === 0);
  report.check('closing it puts it away', closed);
}
