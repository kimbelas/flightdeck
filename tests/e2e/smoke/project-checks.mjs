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
import { agentChecks } from './agent-checks.mjs';
import { mapPresetChecks } from './map-preset-checks.mjs';
import { ticketChecks } from './ticket-checks.mjs';

export const PROJECT = 'C:\\Users\\belas\\Documents\\development\\app-next';
const MISSING = 'C:\\nope\\not-here';

export async function projectChecks(page, report, core) {
  report.group('Projects — import by path (P3-T1)');
  await emptyChecks(page, report, core);
  await importChecks(page, report, core);
  await statusChecks(page, report, core);
  await mapChecks(page, report, core);
  await presetChecks(page, report, core);
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

/**
 * The workflow map on the row — P3-T3, SPEC §5.1(a).
 *
 * The hop no unit test can see: a THIRD request goes out after the list, its answer lands on the
 * right row by `projectKey`, and seven readings come out of `WorkflowMapViewModel` as counts and
 * English. The last check is the one that would break first if somebody "tidied" the panel —
 * opening it must not be required to learn the shape of the config, because the summary IS the
 * panel.
 */
async function mapChecks(page, report, core) {
  const asked = await waitFor(() =>
    core.requests.some((request) => request.path === '/projects/map'),
  );
  report.check('the deck asks core for the workflow map after the list (P3-T3)', asked);

  const drew = await waitFor(async () => (await page.locator('.project-map').count()) === 1);
  report.check('the row grows a workflow-map section once its map arrives', drew);

  const counts = await page.locator('.map-count').allTextContents();
  // Counts closed, detail open. Nothing that is zero is printed — six sections saying "0 commands"
  // is six rows of nothing.
  report.check(
    'the closed summary is the shape of the config, in counts',
    counts.join(' · ') ===
      '1 agent · 1 command · 1 skill · 3 hooks · 1 MCP server · 1 plugin · 2 allow rules · 1 deny rule',
    counts.join(' · '),
  );

  // Closed by default: a repository with 17 hooks does not fit on a row. Asserted on VISIBILITY
  // rather than on a node count, because `<details>` keeps its children in the DOM either way —
  // a count check here passes for a panel that is always open, which is the thing being ruled out.
  report.check(
    'the detail is behind the marker rather than on the row',
    !(await page.locator('.map-section').first().isVisible()),
  );

  await page.locator('.project-map > summary').click();
  const opened = await waitFor(() => page.locator('.map-section').first().isVisible());
  report.check('opening it draws the sections', opened);

  const stack = await page.locator('.map-stack li .map-file').allTextContents();
  report.check(
    'the instruction stack is in resolution order, gaps and all',
    stack.join(' | ') ===
      'user CLAUDE.md (365) | user CLAUDE.md (isg) | CLAUDE.md | AGENTS.md | .claude/soul.md',
    stack.join(' | '),
  );
  const sizes = await page.locator('.map-stack li .map-size').allTextContents();
  report.check(
    'each file says how much of the context window it spends, and an absent one says so',
    sizes.join(' ') === '683 B — 3.5 kB — —',
    sizes.join(' '),
  );

  const events = await page.locator('.map-event').allTextContents();
  // Grouped under headings and never re-sorted — Claude Code runs a group's commands as written.
  report.check(
    'the hook timeline is grouped by event, in run order',
    events.join(' ') === 'PostToolUse PreCompact',
    events.join(' '),
  );
  const commands = await page.locator('.map-hooks li .map-command').allTextContents();
  report.check(
    'and the commands under one event keep the order the file wrote them',
    commands.join(' | ') === 'node fast-lint.mjs | node check-symbols.mjs | node state-dump.mjs',
    commands.join(' | '),
  );

  const permissions = (await page.locator('.map-permissions > summary').textContent()) ?? '';
  report.check(
    'permissions are counted closed, with `defaultMode` first when there is one',
    permissions === '2 allow · 1 deny',
    permissions,
  );

  const names = await page.locator('.map-names .map-badge').allTextContents();
  // A server's name and transport, never its command line (SEC-FS-2's habit). The worktrees lead
  // because their section is drawn outside `Configured` — P3-T4, a git fact rather than a
  // `.claude` one.
  report.check(
    'servers, plugins, marketplaces and conventions are drawn as labels',
    names.join(' | ') ===
      'main (feat/smoke) | XWEB-1853 | XWEB-1854 (feat/rework-the-picker) | ' +
        'chrome-devtools (stdio) | context-hygiene@claude-kit | claude-kit | rules 6 | specs 9',
    names.join(' | '),
  );

  // P3-T4's three cases in one assertion: main is first however core sent them; a tree whose
  // branch repeats its name is not drawn twice; and a tree whose branch differs says both — which
  // includes main, whose branch is the one thing a person standing in a worktree cannot see from
  // the project row above.
  const trees = names.slice(0, 3).join(' | ');
  report.check(
    'the worktrees are drawn main-first, without repeating a branch that is the id',
    trees === 'main (feat/smoke) | XWEB-1853 | XWEB-1854 (feat/rework-the-picker)',
    trees,
  );

  await page.locator('.project-map > summary').click();
}

/**
 * The launch presets on a project row — P4-T1, SPEC §5.6.
 *
 * The hops no unit test can see: a FOURTH request goes out after the list, four presets appear for
 * a folder nobody saved anything for, and pressing one produces a `POST /sessions` whose `cwd` is
 * the project — the field core parsed and dropped from P2-T2 until this task.
 *
 * The check that would break first if somebody "tidied" the panel is the geometry one at the end.
 * `.project` is a two-column grid and its own `forget` button sits in column 2 spanning every row;
 * the preset editor is a grid of its own with buttons in it, so the rule that places that button is
 * scoped to a DIRECT child. Written as a descendant selector it also claims the editor's start
 * button and spans it down the whole editor. A check that read a class name would pass either way.
 */
async function presetChecks(page, report, core) {
  report.group('Presets — the named ways to start a session (P4-T1)');

  const asked = await waitFor(() =>
    core.requests.some((request) => request.path === '/projects/presets'),
  );
  report.check('the deck asks core for the presets after the list', asked);

  const section = page.locator('section.presets');
  const drawn = await waitFor(async () => (await section.locator('.preset-chip').count()) === 4);
  report.check('an imported folder has four presets before anything is saved', drawn);

  const names = await section.locator('.preset-chip').allTextContents();
  // Four, not five: `claude-isg-agents` opens the agents browser and starts nothing, so it has no
  // preset (contracts/launch-preset.ts). Ordered by name, which is core's `byProjectThenName`.
  report.check(
    'they are the four profile functions that can start a session',
    names.join(' ') === '365 isg orchestrator ticket',
    names.join(' '),
  );
  report.check(
    'nothing is open until one is pressed',
    (await section.locator('.preset-editor').count()) === 0,
  );

  await presetStartChecks(page, report, core, section);
  await presetSaveChecks(page, report, core, section);
  await presetGeometryChecks(page, report, section);
  // P9-T1. Last, because it saves and forgets a preset of its own and leaves the four built-ins.
  await agentChecks(page, report, core, section);
  // P9-T2. After it, for the same reason: it saves one preset and forgets it again.
  await mapPresetChecks(page, report, core, section);
  // P9-T3. Saves nothing; its two launches go to the fixture core like the ones above.
  await ticketChecks(page, report, core, section);
}

/** Pressing `ticket`, typing the id, and watching what actually leaves the page. */
async function presetStartChecks(page, report, core, section) {
  await section.locator('.preset-chip', { hasText: 'ticket' }).click();
  const opened = await waitFor(async () => (await section.locator('.preset-editor').count()) === 1);
  report.check('pressing a preset opens one editor', opened);

  report.check(
    'the ticket preset has nothing to plan yet, so it cannot start',
    (await page.inputValue('.preset-prompt')) === '' &&
      (await section.locator('.preset-start').isDisabled()),
  );

  await page.fill('.preset-session-name', 'xweb-2019');
  const prompt = await page.inputValue('.preset-prompt');
  // The four sentences are the model routing, not politeness: `claude-isg-ticket` pins
  // `opusplan[1m]`, so "enter plan mode first" is what puts the planning turn on Fable 5.1.
  report.check(
    'typing the ticket id writes the plan-first prompt, upper-cased',
    prompt.startsWith('Enter plan mode first (EnterPlanMode)') && prompt.includes('XWEB-2019'),
    prompt.slice(0, 60),
  );
  report.check(
    'and the start button becomes pressable',
    !(await section.locator('.preset-start').isDisabled()),
  );

  const before = core.launches.length;
  await section.locator('.preset-start').click();
  const started = await waitFor(() => core.launches.length === before + 1);
  report.check('pressing start reaches core through the rewrite', started);

  const body = core.launches.at(-1) ?? {};
  // The field this task made real. `LaunchRequest` has carried a cwd since P2-T2 and nothing
  // passed it to the process, so every session started from the deck began in core's directory.
  report.check(
    'the launch carries the project folder, which was parsed and dropped before this task',
    body.cwd === PROJECT,
    String(body.cwd),
  );
  report.check(
    'it sends the computed prompt rather than anything stored',
    typeof body.prompt === 'string' && body.prompt.includes('XWEB-2019'),
  );
  report.check(
    'under the profile function the preset names, and named by the ticket',
    // A profile function, never a subscription: the function is the account AND the model, so
    // sending both would be two fields the command line could contradict (D44, P4-T2).
    body.profileFn === 'claude-isg-ticket' &&
      body.subscription === undefined &&
      body.name === 'xweb-2019',
    `${String(body.profileFn)} - ${String(body.name)}`,
  );
}

/** Saving what is in the boxes, and taking it away again. */
async function presetSaveChecks(page, report, core, section) {
  report.check(
    'a built-in offers no forget — there is no row to remove',
    (await section.locator('.preset-forget').count()) === 0,
  );

  await page.fill('.preset-save-name', 'morning triage');
  await page.fill('.preset-group', 'morning');
  await section.locator('.preset-save').click();

  const saved = await waitFor(() => core.presets.size === 1);
  report.check('saving reaches core', saved);
  const held = [...core.presets.values()][0] ?? {};
  report.check(
    'with the id derived from the name, and the group P6-T4 will launch by',
    held.id === 'morning-triage' && held.group === 'morning',
    `${String(held.id)} - ${String(held.group)}`,
  );
  report.check(
    'and the folder it was filed under, from an empty box meaning the project root',
    held.cwd === PROJECT,
    String(held.cwd),
  );

  const five = await waitFor(async () => (await section.locator('.preset-chip').count()) === 5);
  report.check('the saved preset appears beside the four built-ins', five);

  // Found by running it: a saved preset that SHADOWS a built-in is the same word on the same chip,
  // so until you open one there is nothing to tell them apart. The title is that one thing.
  const titles = await section
    .locator('.preset-chip')
    .evaluateAll((chips) => chips.map((chip) => chip.title));
  report.check(
    'a saved preset says so, and every chip says which function and folder it means',
    titles.filter((title) => title.startsWith('saved · ')).length === 1 &&
      titles.every((title) => title.includes('claude-') && title.includes('project root')),
    titles.join(' | '),
  );

  await section.locator('.preset-chip', { hasText: 'morning triage' }).click();
  const offers = await waitFor(async () => (await section.locator('.preset-forget').count()) === 1);
  report.check('a saved preset offers forget', offers);

  await section.locator('.preset-forget').click();
  const back = await waitFor(async () => (await section.locator('.preset-chip').count()) === 4);
  report.check('forgetting it leaves the four built-ins and removes the row at core', back);
  report.check('core holds no saved preset afterwards', core.presets.size === 0);
}

/**
 * Where the boxes actually land — the half a class-name assertion cannot see.
 *
 * Two facts, both of which a CSS change can break silently, and **both have been watched fail**
 * (RESEARCH.md G.29): dropping `grid-column: 1` from `.presets` moves the section into the forget
 * button's column and the first check reports `327 <= 82`; widening `.project > button` to a
 * descendant selector moves the start button to the editor's first row and the second reports
 * `start y 212 vs name y 263`. A third check — that the button is one control tall — was written
 * and then deleted, because neither sabotage moved it: it read as a guard and was not one.
 */
async function presetGeometryChecks(page, report, section) {
  await section.locator('.preset-chip', { hasText: 'ticket' }).click();
  await waitFor(async () => (await section.locator('.preset-editor').count()) === 1);

  const presets = await section.boundingBox();
  // Named by its label rather than by being "the direct-child button": since P3-T6 the project
  // NAME is a direct-child button too, and `.project > button` resolves to two elements. That is
  // the collision the CSS rule beside it is written for, so the check that guards the rule has to
  // say which button it means.
  const rowForget = await page.locator('.project > button[aria-label^="forget"]').boundingBox();
  report.check(
    'the presets stay in the row’s first column, clear of the forget button',
    presets.x + presets.width <= rowForget.x + 1,
    `${String(Math.round(presets.x + presets.width))} <= ${String(Math.round(rowForget.x))}`,
  );

  const name = await section.locator('.preset-session-name').boundingBox();
  const start = await section.locator('.preset-start').boundingBox();
  report.check(
    'the start button sits beside the name box, on its row',
    start.x >= name.x + name.width - 1 && Math.abs(start.y - name.y) < name.height,
    `start y ${String(Math.round(start.y))} vs name y ${String(Math.round(name.y))}`,
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
  // The DIRECT child. P4-T1 put a `forget` button inside the preset editor as well, and a
  // descendant selector here would match two elements and fail on strict mode rather than on the
  // thing being tested.
  await page.locator('.project > button[aria-label^="forget"]').click();

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
