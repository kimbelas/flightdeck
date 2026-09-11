// P0-T7 runner.
//
//   node scripts/security-probe-cli.ts
//
// Stands up a core-shaped server on 4950, a deck origin on 4949 and a hostile origin on 5999,
// then attacks 4950 from Node and from Chromium and prints what refused each attempt. Everything
// binds 127.0.0.1 and nothing leaves the machine.
import { randomBytes } from 'node:crypto';
import { PageOrigin } from './page-origin.ts';
import { ProbeServer } from './security-probe.ts';
import { ATTACK_PAGE, BrowserProbe, type AttackResult } from './security-probe-browser.ts';
import { NodeProbe, type Attempt } from './security-probe-client.ts';

const CORE_PORT = 4950;
const DECK_PORT = 4949;
const HOSTILE_PORT = 5999;
const DECK_ORIGIN = `http://127.0.0.1:${String(DECK_PORT)}`;
const TOKEN = randomBytes(32).toString('hex');
const WRONG_TOKEN = randomBytes(32).toString('hex');

function row(label: string, verdict: string, detail: string): void {
  console.log(`  ${label.padEnd(42)}${verdict.padEnd(26)}${detail}`);
}

/** Every Node-side attempt, each shaped to isolate one control. */
async function nodeProbes(probe: NodeProbe): Promise<readonly Attempt[]> {
  const core = `127.0.0.1:${String(CORE_PORT)}`;
  return [
    await probe.post('rebinding host (evil name)', { host: 'flightdeck.evil.test', token: TOKEN }),
    await probe.post('host with the wrong port', { host: '127.0.0.1:1234', token: TOKEN }),
    await probe.post('host 0.0.0.0', { host: `0.0.0.0:${String(CORE_PORT)}`, token: TOKEN }),
    await probe.post('no token', { host: core }),
    await probe.post('wrong token, same length', { host: core, token: WRONG_TOKEN }),
    await probe.post('token + content-type text/plain', {
      host: core,
      token: TOKEN,
      contentType: 'text/plain',
    }),
    await probe.post('token + forged Origin', {
      host: core,
      token: TOKEN,
      origin: 'http://evil.test',
    }),
    await probe.post('token + Sec-Fetch-Site cross-site', {
      host: core,
      token: TOKEN,
      fetchSite: 'cross-site',
    }),
    await probe.post('token + oversize body', { host: core, token: TOKEN, bodyBytes: 200_000 }),
    await probe.post('token, no Origin (the hook path)', { host: core, token: TOKEN }),
    await probe.socket('ws with no Origin', { token: TOKEN, sendFirstFrame: true }),
    await probe.socket('ws from a hostile Origin', {
      origin: `http://127.0.0.1:${String(HOSTILE_PORT)}`,
      token: TOKEN,
      sendFirstFrame: true,
    }),
    await probe.socket('ws deck Origin, wrong first frame', {
      origin: DECK_ORIGIN,
      token: WRONG_TOKEN,
      sendFirstFrame: true,
    }),
    await probe.socket('ws deck Origin, silent', { origin: DECK_ORIGIN }),
    await probe.socket('ws deck Origin, correct token', {
      origin: DECK_ORIGIN,
      token: TOKEN,
      sendFirstFrame: true,
    }),
  ];
}

function reportNode(attempts: readonly Attempt[]): void {
  console.log('\nNode client — forging is the faithful attack here (Host, token, body)\n');
  console.log(`  ${'attempt'.padEnd(42)}${'outcome'.padEnd(26)}detail`);
  for (const attempt of attempts) {
    const verdict = attempt.status === 0 ? 'no answer' : `status ${String(attempt.status)}`;
    row(attempt.name, verdict, attempt.detail);
  }
}

function reportServer(server: ProbeServer): void {
  console.log('\nWhat the server decided, and which control did it\n');
  console.log(`  ${'kind'.padEnd(9)}${'control'.padEnd(12)}${'status'.padEnd(8)}reason`);
  for (const decision of server.taken()) {
    const verdict = decision.accepted ? 'ACCEPTED' : decision.control;
    console.log(
      `  ${decision.kind.padEnd(9)}${verdict.padEnd(12)}${String(decision.status).padEnd(8)}` +
        `${decision.reason}  ·  ${decision.label}`,
    );
  }
}

function reportBrowser(from: string, results: readonly AttackResult[]): void {
  console.log(`\nChromium, page served from ${from}\n`);
  console.log(`  ${'attack'.padEnd(42)}${'page saw'.padEnd(26)}detail`);
  for (const result of results) row(result.name, result.outcome, result.detail);
}

async function main(): Promise<number> {
  const server = new ProbeServer({
    port: CORE_PORT,
    uiOrigin: DECK_ORIGIN,
    token: TOKEN,
    bodyLimitBytes: 64 * 1024,
  });
  const deck = new PageOrigin({
    port: DECK_PORT,
    page: ATTACK_PAGE,
    rewriteTo: { port: CORE_PORT, token: TOKEN },
  });
  const hostile = new PageOrigin({ port: HOSTILE_PORT, page: ATTACK_PAGE });
  const browser = new BrowserProbe();

  await server.start();
  await deck.start();
  await hostile.start();
  try {
    const probe = new NodeProbe(CORE_PORT);
    reportNode(await nodeProbes(probe));

    const lan = NodeProbe.lanAddress();
    console.log('\nSEC-NET-1 — is anything answering off the loopback interface?\n');
    if (lan === undefined) {
      row('no non-loopback IPv4 on this machine', 'not testable', 'nothing to bind to');
    } else {
      const reach = await probe.reachable(`connect to ${lan}`, lan, 2_000);
      row(reach.name, reach.status === 200 ? 'REACHABLE — bad' : 'not reachable', reach.detail);
    }

    await browser.open();
    reportBrowser(
      `${hostile.origin} (hostile)`,
      await browser.attackFrom(hostile.origin, {
        target: `http://127.0.0.1:${String(CORE_PORT)}`,
        socket: `ws://127.0.0.1:${String(CORE_PORT)}/pty`,
        token: TOKEN,
        includeRewrite: false,
      }),
    );
    reportBrowser(
      `${deck.origin} (the deck's own origin)`,
      await browser.attackFrom(deck.origin, {
        target: `http://127.0.0.1:${String(CORE_PORT)}`,
        socket: `ws://127.0.0.1:${String(CORE_PORT)}/pty`,
        token: TOKEN,
        includeRewrite: true,
      }),
    );

    reportServer(server);
    return 0;
  } finally {
    await browser.close();
    await hostile.stop();
    await deck.stop();
    await server.stop();
  }
}

process.exitCode = await main();
