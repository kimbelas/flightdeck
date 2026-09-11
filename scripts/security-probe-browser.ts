// P0-T7 — the half of the probe that needs a real browser.
//
// A Node client cannot prove SEC-HTTP-2 or SEC-HTTP-5: it sets `Origin` and `Sec-Fetch-Site` to
// whatever it is told, so a pass would mean nothing. Only a browser refuses to let the page lie
// about where it came from, and only a browser runs the preflight rule that SEC-HTTP-4 leans on.
// So the cross-origin half runs in Chromium, and the Host-forging half stays in Node
// (security-probe-cli.ts), where forging *is* the faithful attack.
//
// The attack code lives in the page as text, not as a TypeScript callback: this project compiles
// with `lib: ES2023` and no DOM, and adding the DOM lib to satisfy a string of attacker
// JavaScript would loosen type-checking for all of core/.
import { chromium, type Browser } from 'playwright';

export interface AttackResult {
  readonly name: string;
  /** What the *page* saw. The server's own view is in ProbeServer.taken(). */
  readonly outcome: 'blocked' | 'ok' | 'opaque' | 'error';
  readonly detail: string;
}

export interface AttackOptions {
  readonly target: string;
  readonly socket: string;
  readonly token: string;
  /** Only the deck origin has a rewrite to try; a hostile page has no server helping it. */
  readonly includeRewrite: boolean;
}

/** Served to the browser. `fdAttack` is called by name so no DOM types are needed in Node. */
export const ATTACK_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>fd probe</title>
<body>
<script>
async function post(target, contentType, extraHeaders, mode) {
  const headers = Object.assign({ 'content-type': contentType }, extraHeaders || {});
  const response = await fetch(target + '/probe', {
    method: 'POST', headers: headers, body: '{"probe":true}', mode: mode || 'cors',
  });
  if (response.type === 'opaque') return { outcome: 'opaque', detail: 'sent, response unreadable' };
  return { outcome: 'ok', detail: 'status ' + response.status };
}

function socketAttempt(url) {
  return new Promise(function (resolve) {
    var settled = false;
    var done = function (outcome, detail) {
      if (settled) return;
      settled = true;
      resolve({ outcome: outcome, detail: detail });
    };
    var ws;
    try { ws = new WebSocket(url); } catch (error) { done('blocked', String(error)); return; }
    setTimeout(function () { done('error', 'no answer in 3 s'); try { ws.close(); } catch (e) {} }, 3000);
    ws.onopen = function () { ws.send('not-the-token'); };
    ws.onmessage = function (event) { done('ok', 'server replied ' + String(event.data)); };
    ws.onclose = function (event) { done('blocked', 'closed code ' + event.code); };
    ws.onerror = function () { done('blocked', 'handshake refused'); };
  });
}

window.fdAttack = async function (options) {
  var results = [];
  async function attempt(name, run) {
    try { var r = await run(); results.push({ name: name, outcome: r.outcome, detail: r.detail }); }
    catch (error) { results.push({ name: name, outcome: 'blocked', detail: String(error) }); }
  }

  await attempt('fetch json (preflighted)', function () {
    return post(options.target, 'application/json');
  });
  await attempt('fetch text/plain (simple, no preflight)', function () {
    return post(options.target, 'text/plain');
  });
  await attempt('fetch json with a leaked token', function () {
    return post(options.target, 'application/json', { authorization: 'Bearer ' + options.token });
  });
  await attempt('fetch no-cors text/plain', function () {
    return post(options.target, 'text/plain', {}, 'no-cors');
  });
  await attempt('websocket upgrade', function () {
    return socketAttempt(options.socket);
  });
  if (options.includeRewrite) {
    await attempt('same-origin rewrite', function () {
      return post('', 'application/json');
    });
  }
  return results;
};
</script>
</body>`;

/** Drives Chromium through the attack list from one origin. */
export class BrowserProbe {
  private browser: Browser | undefined;

  public async open(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
  }

  public async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  /** Loads `pageOrigin` and runs every attack from it. Console errors are not failures here. */
  public async attackFrom(
    pageOrigin: string,
    options: AttackOptions,
  ): Promise<readonly AttackResult[]> {
    const browser = this.browser;
    if (browser === undefined) throw new Error('BrowserProbe.open() was not called');
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(pageOrigin, { waitUntil: 'load' });
      // A string expression, not a callback: see the note at the top of this file.
      const call = `window.fdAttack(${JSON.stringify(options)})`;
      return await page.evaluate<readonly AttackResult[]>(call);
    } finally {
      await context.close();
    }
  }
}
