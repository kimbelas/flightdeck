// The Start launcher — P10-T2. The header's Start, on the board: pick a project, an account and
// how to start, press Start, and the right `POST /sessions` goes out.
//
// Against the fixture core, whose map gives every imported folder the same five assets, so the
// chips drawn here are known: `/fix-review`, `/design-check`, `/superpowers:brainstorming`, and
// the agents `german-ui-expert` and `shell-review:bash-script-auditor`.
import { chooseView } from './board-checks.mjs';
import { settle, waitFor } from './report.mjs';

const MORNING = String.raw`C:\Users\dev\Documents\development\morning-app`;
const MORNING_KEY = MORNING.toLowerCase();

export async function startChecks(page, report, core) {
  report.group('The Start launcher (P10-T2)');
  await chooseView(page, 'board');
  await openingChecks(page, report);
  await importChecks(page, report);
  await skillLaunchChecks(page, report, core);
  await memoryChecks(page, report);
  await agentLaunchChecks(page, report, core);
  await closingChecks(page, report);
  await chooseView(page, 'panes');
}

async function openLauncher(page) {
  await page.locator('[data-start-open]').click();
  await waitFor(async () => (await page.locator('[data-start-launcher]').count()) === 1);
}

async function openingChecks(page, report) {
  await openLauncher(page);
  report.check(
    'Start opens the launcher',
    (await page.locator('[data-start-launcher]').count()) === 1,
  );
  const tiles = await page.locator('[data-start-project]').count();
  report.check('every imported folder is a tile', tiles >= 1, `${String(tiles)} tile(s)`);
  report.check(
    'nothing past step 1 is drawn before a project is picked',
    (await page.locator('[data-start-account]').count()) === 0,
  );
  report.check(
    'Start says what is missing rather than being grey for no reason',
    (await page.locator('[data-start-go]').innerText()) === 'Pick a project',
  );
}

/** "choose folder…" imports, and the folder it imported becomes the picked tile. */
async function importChecks(page, report) {
  await page.locator('[data-start-choose]').click();
  await page.locator('[data-start-path]').fill(MORNING);
  await page.locator('[data-start-path]').press('Enter');
  const picked = await waitFor(
    async () =>
      (await page
        .locator(`[data-start-project="${cssEscape(MORNING_KEY)}"]`)
        .getAttribute('aria-pressed')) === 'true',
  );
  report.check('choose folder imports it, and picks its new tile', picked);
  const bypass = await page.locator('[data-start-bypass]').innerText();
  report.check(
    'the account step says every launch bypasses permissions',
    bypass.includes('--dangerously-skip-permissions'),
    bypass,
  );
}

async function skillLaunchChecks(page, report, core) {
  await page.locator('[data-start-account="365"]').click();
  await page.locator('[data-start-starter="skill:fix-review"]').click();
  const label = await page.locator('[data-start-go]').innerText();
  report.check('with a skill picked, Start names the account', label === 'Start on 365', label);
  const before = core.launches.length;
  await page.locator('[data-start-go]').click();
  const sent = await waitFor(() => core.launches.length === before + 1);
  const launch = core.launches.at(-1);
  report.check(
    'Start sends the skill as the first prompt, in that folder, on that account',
    sent &&
      launch?.profileFn === 'claude-365' &&
      launch.prompt === '/fix-review' &&
      launch.cwd === MORNING &&
      /^morning-app-\d{4}-\d{4}$/u.test(launch.name),
    JSON.stringify(launch),
  );
  const closed = await waitFor(
    async () => (await page.locator('[data-start-launcher]').count()) === 0,
  );
  report.check('the launcher closes once core has started it', closed);
}

/** The account is remembered per folder, and a lock takes the other one away. */
async function memoryChecks(page, report) {
  await openLauncher(page);
  await page.locator(`[data-start-project="${cssEscape(MORNING_KEY)}"]`).click();
  report.check(
    'the folder starts on the account it was last started on',
    (await page.locator('[data-start-account="365"]').getAttribute('aria-pressed')) === 'true',
  );
  await page.locator('[data-start-lock]').check();
  await settle(page);
  report.check(
    'locked, the other account cannot be chosen and the tile says so',
    (await page.locator('[data-start-account="isg"]').isDisabled()) &&
      (await page.locator(`[data-start-project="${cssEscape(MORNING_KEY)}"]`).innerText()).includes(
        '365 only',
      ),
  );
}

async function agentLaunchChecks(page, report, core) {
  await page.locator('[data-start-starter="agent:german-ui-expert"]').click();
  report.check(
    'an agent needs a prompt, and Start says so',
    (await page.locator('[data-start-go]').innerText()) === 'Say what the agent should do',
  );
  await page.locator('[data-start-prompt]').fill('label the settings page');
  await page.locator('[data-start-name]').fill('morning-labels');
  const before = core.launches.length;
  await page.locator('[data-start-go]').click();
  await waitFor(() => core.launches.length === before + 1);
  const launch = core.launches.at(-1);
  report.check(
    'an agent goes out as --agent with the typed prompt and name',
    launch?.agent === 'german-ui-expert' &&
      launch.prompt === 'label the settings page' &&
      launch.name === 'morning-labels' &&
      launch.profileFn === 'claude-365',
    JSON.stringify(launch),
  );
}

async function closingChecks(page, report) {
  await openLauncher(page);
  await page.keyboard.press('Escape');
  const gone = await waitFor(
    async () => (await page.locator('[data-start-launcher]').count()) === 0,
  );
  report.check('Esc closes the launcher', gone);
  // Leave the lock off, so nothing after this inherits it.
  await openLauncher(page);
  await page.locator(`[data-start-project="${cssEscape(MORNING_KEY)}"]`).click();
  await page.locator('[data-start-lock]').uncheck();
  await page.locator('[data-start-close]').click();
}

/** A folder key inside an attribute selector: its backslashes and colon are escaped. */
function cssEscape(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}
