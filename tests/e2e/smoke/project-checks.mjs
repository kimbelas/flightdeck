// The projects panel, end to end — P3-T1, DECISIONS.md D26.
//
// The first check is the one the task exists for and the one a "helpful" future change would break
// first: **the panel is empty on a deck that has never imported anything.** Nothing scans the disk
// and no project list is compiled in, so a panel with a row in it on a fresh machine means
// something started discovering folders. No unit test can see that — the store's list is whatever a
// fake answered — so it belongs here, against a real page and a fixture core whose registry starts
// empty.
//
// The rest walks the one flow this task shipped: type a path, watch it come back from core, refuse
// a bad one with a sentence rather than a code, and withdraw it again. Every hop is real — the
// page's own `fetch`, the rewrite with its server-side bearer, core's parser.
import { waitFor } from './report.mjs';

const PROJECT = 'C:\\Users\\belas\\Documents\\development\\app-next';
const MISSING = 'C:\\nope\\not-here';

export async function projectChecks(page, report, core) {
  report.group('Projects — import by path (P3-T1)');
  await emptyChecks(page, report, core);
  await importChecks(page, report, core);
  await statusChecks(page, report, core);
  await refusalChecks(page, report);
  await forgetChecks(page, report, core);
}

async function emptyChecks(page, report, core) {
  const panel = page.locator('section[aria-label="projects"]');
  const drawn = await waitFor(async () => (await panel.count()) === 1);
  report.check('the projects panel is on the deck', drawn);

  // The registry ships empty and the deck asked core rather than assuming (D26).
  const asked = core.requests.some(
    (request) => request.method === 'GET' && request.path === '/projects',
  );
  report.check('the deck reads the registry from core on load', asked);
  report.check(
    'no project is listed until one is imported — nothing scans the disk',
    (await panel.locator('.project').count()) === 0,
  );
  report.check(
    'the empty state says why rather than reporting a failed search',
    ((await panel.locator('p.muted').textContent()) ?? '').includes('nothing is scanned'),
  );
}

async function importChecks(page, report, core) {
  await page.fill('#project-path', PROJECT);
  await page.locator('.project-add button').click();

  const arrived = await waitFor(() => core.projects.size === 1);
  report.check('the import reaches core through the rewrite', arrived);
  report.check(
    'it carries the path exactly as it was typed',
    [...core.projects.values()][0]?.path === PROJECT,
  );

  const listed = await waitFor(async () => (await page.locator('.project').count()) === 1);
  report.check('the imported folder appears in the panel', listed);
  report.check(
    'it is named by its last segment, and shows the whole path',
    (await page.locator('.project-name').textContent()) === 'app-next' &&
      (await page.locator('.project-path').textContent()) === PROJECT,
  );
  const cleared = await waitFor(async () => (await page.inputValue('#project-path')) === '');
  report.check('an accepted import clears the box', cleared);
}

/**
 * Stack and git on the row — P3-T2.
 *
 * The fixture core answers a fixed reading rather than running `git`, because what is being tested
 * here is the hop the unit tests cannot see: a second request goes out after the list, its answer
 * lands on the right row by `projectKey`, and the numbers come out as English. Whether porcelain
 * v2 parses is settled in tests/contracts.
 */
async function statusChecks(page, report, core) {
  const asked = await waitFor(() =>
    core.requests.some((request) => request.path === '/projects/status'),
  );
  report.check('the deck asks core for the readings after the list (P3-T2)', asked);

  const drew = await waitFor(async () => (await page.locator('.project-meta').count()) === 1);
  report.check('the row grows a second line once its reading arrives', drew);

  const stack = await page.locator('.project-stack').allTextContents();
  // Framework before runtime — the specific answer first, then the general one.
  report.check(
    'the detected stack is drawn in core’s order',
    stack.join(' ') === 'Next.js Node',
    stack.join(' '),
  );

  report.check(
    'the branch is on the row',
    (await page.locator('.project-branch').textContent()) === 'feat/smoke',
  );

  const summary = (await page.locator('.project-git').textContent()) ?? '';
  // Numbers on the wire, English on the screen. Nothing here was composed by core.
  report.check(
    'the counts are drawn as a phrase, in the order somebody acts on them',
    summary === '3 changed · 2 ahead',
    summary,
  );
  report.check(
    'nothing that is zero is printed',
    !summary.includes('0') && !summary.includes('behind'),
    summary,
  );
}

async function refusalChecks(page, report) {
  await page.fill('#project-path', MISSING);
  await page.locator('.project-add button').click();

  const said = await waitFor(async () => (await page.locator('.project-problem').count()) === 1);
  report.check('a refused import says something', said);

  const message = (await page.locator('.project-problem').textContent()) ?? '';
  // English, not `missing` — core sends a closed union of codes precisely so the deck can turn one
  // into a sentence without ever displaying text core composed.
  report.check(
    'it is a sentence, not the refusal code',
    message.includes('no folder') && !message.includes('missing'),
    message,
  );
  report.check(
    'the project that was already imported is still there',
    (await page.locator('.project').count()) === 1,
  );
}

async function forgetChecks(page, report, core) {
  await page.locator('.project button', { hasText: 'forget' }).click();

  const withdrawn = await waitFor(() => core.projects.size === 0);
  report.check('forget reaches core and removes the row there', withdrawn);

  const gone = await waitFor(async () => (await page.locator('.project').count()) === 0);
  report.check('the panel goes back to empty, from core\u2019s answer rather than locally', gone);

  // The reading goes with the row. A branch left on screen for a folder core may no longer read
  // would be the cache outliving the permission, drawn (P3-T2, SEC-FS-1).
  report.check(
    'the withdrawn folder\u2019s reading goes with it',
    (await page.locator('.project-meta').count()) === 0,
  );
}
