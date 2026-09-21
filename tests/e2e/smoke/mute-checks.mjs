// Per-session mute for the Windows toasts — P6-T3, SPEC §5.5.
//
// **No toast is raised here and none could be.** A CI runner has no SnoreToast, and the half that
// decides which events are worth interrupting somebody for is settled in `toast-announcer.test.ts`
// — including the three cases that must say nothing. What lives on this side of the wire is the
// switch: what it sends, where its position comes from, and whether it survives a reload.
//
// **The position is core's answer, not the page's.** That is the one thing about a mute worth
// checking through a browser, because the switch is a promise about what happens at 2 a.m. with
// this page closed. So the check that matters is the last one: core is told to forget the mute
// behind the deck's back, the page is reloaded, and the switch has to come back up.
import { waitFor } from './report.mjs';

const clean = (text) => (text ?? '(none)').replaceAll(/\s+/gu, ' ').trim();

export async function muteChecks(page, report, core) {
  report.group('Per-session toast mute (P6-T3)');

  if (!(await openSessionPane(page, report))) return;
  const button = page.locator('[data-pane-mute]');
  const offered = await waitFor(async () => (await button.count()) === 1);
  report.check('the pane offers a mute', offered);
  if (!offered) return;

  await muteChecksFor(page, report, core, button.first());
  await closeEveryPane(page);
}

/** A pane on a background session — the only kind that has a session to be quiet about. */
async function openSessionPane(page, report) {
  await closeEveryPane(page);
  await page.locator('[data-project-all]').click();
  const open = page.locator('.row button', { hasText: 'open pane' }).first();
  if ((await open.count()) === 0) {
    report.check('a background session is on the list to mute', false, 'no open-pane button');
    return false;
  }
  await open.click();
  const mounted = await waitFor(async () => (await page.locator('.pane-card').count()) === 1, {
    timeout: 20_000,
  });
  report.check('a pane is open on a background session', mounted);
  return mounted;
}

async function muteChecksFor(page, report, core, button) {
  report.check(
    'it starts unmuted, and says what pressing it will do',
    clean(await button.textContent()) === 'mute' &&
      (await button.getAttribute('aria-pressed')) === 'false',
    `${clean(await button.textContent())} / aria-pressed=${String(await button.getAttribute('aria-pressed'))}`,
  );

  await button.click();
  const muted = await waitFor(() => core.muted.size === 1);
  const key = [...core.muted][0] ?? '';
  report.check('pressing it tells core to stop toasting about this session', muted, key);
  report.check(
    'the mute is keyed on BOTH ids — a uuid alone is not unique across the two config dirs',
    /^(365|isg):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(key),
    key,
  );

  const flipped = await waitFor(async () => clean(await button.textContent()) === 'unmute');
  report.check('the label flips, because core answered with the set it now holds', flipped);
  report.check(
    'and a screen reader is told the state, which the one word cannot carry',
    (await button.getAttribute('aria-pressed')) === 'true',
  );
  report.check(
    'the title says what is true now rather than what the button does',
    clean(await button.getAttribute('title')).includes('is not raising'),
    clean(await button.getAttribute('title')),
  );

  await button.click();
  report.check('pressing it again unmutes', await waitFor(() => core.muted.size === 0));

  await survivesReloadCheck(page, report, core);
  await positionIsCoresCheck(page, report, core);
}

/** A mute outlives the page: it is in core's store, not in this tab (D16). */
async function survivesReloadCheck(page, report, core) {
  await page.locator('[data-pane-mute]').first().click();
  await waitFor(() => core.muted.size === 1);

  await page.reload();
  await page.locator('[data-project-all]').click();
  const open = page.locator('.row button', { hasText: 'open pane' }).first();
  await open.click();
  const back = await waitFor(
    async () => clean(await page.locator('[data-pane-mute]').first().textContent()) === 'unmute',
    { timeout: 20_000 },
  );
  report.check('the mute survives a reload, because it is core that remembers it', back);
}

/**
 * The check this whole group is really for.
 *
 * Core forgets the mute without the deck being told — which is what another tab, or a store that
 * refused the write, looks like from here. The page must not go on drawing a switch it believes
 * in: the set arrives on connect, so a reload has to bring the switch back up.
 */
async function positionIsCoresCheck(page, report, core) {
  core.muted.clear();

  await page.reload();
  await page.locator('[data-project-all]').click();
  await page.locator('.row button', { hasText: 'open pane' }).first().click();
  const up = await waitFor(
    async () => clean(await page.locator('[data-pane-mute]').first().textContent()) === 'mute',
    { timeout: 20_000 },
  );
  report.check('the switch shows CORE’s answer, not what this page last pressed', up);
}

async function closeEveryPane(page) {
  for (let guard = 0; guard < 12; guard += 1) {
    const button = page.locator('.pane-card .pane-head button', { hasText: 'close' }).first();
    if ((await button.count()) === 0) return;
    await button.click();
  }
}
