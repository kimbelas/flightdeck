// The by-project view, the palette's "switch project", and the layout that follows it — P3-T6.
//
// It runs LAST and imports its own folder, because `projectChecks` ends by forgetting the one it
// imported: an empty registry is the state this group wants to start from, and re-using that one
// would make these checks depend on the order of somebody else's.
//
// **The folder it imports is the one the fixture sessions are actually in.** Four of the seven
// fixture rows have `…\Documents\ledger` as their cwd and three have `…\atlas`, so importing
// `ledger` makes every count here a real derivation over real rows rather than a zero that would
// pass whatever the code did.
import { waitFor } from './report.mjs';

/** Exported: it is where four of the fixture's sessions live, so P6-T6's group needs it. */
export const LEDGER = String.raw`C:\Users\owner\Documents\ledger`;
/** Of the seven fixture rows: alpha, bravo, delta and foxtrot. Three of those four are live. */
const LEDGER_SESSIONS = 4;
const OTHER_SESSIONS = 3;

export async function projectViewChecks(page, report, core) {
  report.group('By project — sessions, gates, the palette and the layout (P3-T6)');

  await importLedger(page, report, core);
  await sessionCountChecks(page, report);
  await gatesChecks(page, report);
  await focusChecks(page, report);
  await paletteChecks(page, report);
  await layoutPerProjectChecks(page, report);
}

async function importLedger(page, report, core) {
  await page.fill('#project-path', LEDGER);
  await page.locator('.project-add button', { hasText: 'import' }).click();
  const arrived = await waitFor(() => core.projects.size === 1);
  report.check('the folder the fixture sessions are in is imported', arrived);
  await waitFor(async () => (await page.locator('.project').count()) === 1);
}

/** SPEC §5.6's "sessions there across both subs", as a number derived from the rows on screen. */
async function sessionCountChecks(page, report) {
  const line = page.locator('[data-project-sessions]');
  const shown = await waitFor(async () => (await line.count()) === 1);
  const text = (await line.allTextContents())[0] ?? '(none)';
  report.check('the project row counts the sessions in that folder', shown);
  report.check(
    'and says how many of them are live, from the rows rather than from a stored number',
    text.startsWith(`${String(LEDGER_SESSIONS)} sessions`) && text.includes('live'),
    text,
  );

  const outside = (await page.locator('.project-unassigned').allTextContents())[0] ?? '(none)';
  report.check(
    'and the sessions in no imported folder are named rather than quietly dropped',
    outside.startsWith(String(OTHER_SESSIONS)),
    outside,
  );
}

/**
 * The gates row — and the sentence it does NOT say.
 *
 * `gates.json` holds no verdict (contracts/project-gates.ts), so a row claiming one would be this
 * project scoring a config, which D12 rules out. The check is therefore two-sided: the counts are
 * there, and the words are not.
 */
async function gatesChecks(page, report) {
  const gates = page.locator('[data-project-gates]');
  const drawn = await waitFor(async () => (await gates.count()) === 1);
  const text = (await gates.allTextContents())[0] ?? '(none)';
  report.check('a coached project says what coach gates in it', drawn);
  report.check(
    'by count — eight gates, four denied paths, one asked',
    text.includes('coach gates 8') && text.includes('denies 4') && text.includes('asks 1'),
    text,
  );
  report.check(
    'and never claims a verdict, because the file it read holds none (D12)',
    !/pass|fail|verdict is|score/iu.test(text.replace('verdict on coach', '')),
    text,
  );

  const href = await gates.locator('a').getAttribute('href');
  report.check(
    'the verdict is a link to coach on 4747, keyed by the project name',
    href === 'http://127.0.0.1:4747/plans/ledger',
    String(href),
  );
}

/** Focusing a project narrows the LIST and nothing else. */
async function focusChecks(page, report) {
  const before = await page.locator('article.row').count();
  report.check('every session is listed to begin with', before === 7, String(before));

  await page.locator('[data-project-focus]').click();
  const narrowed = await waitFor(
    async () => (await page.locator('article.row').count()) === LEDGER_SESSIONS,
  );
  const count = await page.locator('article.row').count();
  report.check(
    'focusing a project narrows the session list to that folder',
    narrowed,
    String(count),
  );

  // The header counts the MACHINE, not the current project — losing sight of a session is the one
  // thing this deck exists to prevent, and the count is where somebody would notice.
  const header = (await page.locator('.deck-head .muted').allTextContents())[0] ?? '';
  report.check(
    'while the header still counts every session on the machine',
    header.includes('7 sessions'),
    header,
  );

  await page.locator('[data-project-all]').click();
  const restored = await waitFor(async () => (await page.locator('article.row').count()) === 7);
  report.check('All projects puts them back', restored);
}

/** SPEC §5.4's sixth palette entry, which `deck-commands.ts` listed as missing since P2-T5. */
async function paletteChecks(page, report) {
  await page.locator('h1').click();
  await page.keyboard.press('Control+k');
  await page.locator('.palette-input').fill('Switch to ledger');
  const offered = await waitFor(async () => (await page.locator('.palette-item').count()) > 0);
  const entry = (await page.locator('.palette-item').first().allTextContents())[0] ?? '';
  report.check('the palette offers switching to a project', offered);
  report.check(
    'with the session count beside it, from the same object the panel draws from',
    entry.includes('ledger') && entry.includes(`${String(LEDGER_SESSIONS)} sessions`),
    entry.replaceAll(/\s+/gu, ' '),
  );

  await page.keyboard.press('Enter');
  const switched = await waitFor(
    async () => (await page.locator('article.row').count()) === LEDGER_SESSIONS,
  );
  report.check('and running it switches the deck to that project', switched);
}

/**
 * SPEC §5.3's "saved per project", which P5a-T5 deferred until there was a project to key it by.
 *
 * The check is that the two do not share: choose a layout while a project is current, go back to
 * all projects, and the other layout is still what it was.
 */
async function layoutPerProjectChecks(page, report) {
  await page.locator('[data-pane-layout-option="9"]').click();
  const nine = await waitFor(async () => (await page.locator('.panes.panes-9').count()) === 1);
  report.check('a layout chosen while a project is current takes effect', nine);

  await page.locator('[data-project-all]').click();
  const back = await waitFor(async () => (await page.locator('.panes.panes-9').count()) === 0);
  const layout = await page.locator('.panes').getAttribute('data-pane-layout');
  report.check(
    'going back to all projects brings back the layout that was chosen THERE',
    back,
    `all projects is ${String(layout)}-up, the project was 9`,
  );

  await page.locator('[data-project-focus]').click();
  const again = await waitFor(async () => (await page.locator('.panes.panes-9').count()) === 1);
  report.check('and switching back to the project brings its own layout back', again);

  // The current project survives a reload, which is the half that makes it worth storing at all.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const remembered = await waitFor(
    async () => (await page.locator('article.row').count()) === LEDGER_SESSIONS,
    { timeout: 20_000 },
  );
  report.check('the current project is still current after a reload', remembered);
  report.check(
    'and so is its layout',
    (await page.locator('.panes.panes-9').count()) === 1,
    String(await page.locator('.panes').getAttribute('data-pane-layout')),
  );

  await page.locator('[data-project-all]').click();
}
