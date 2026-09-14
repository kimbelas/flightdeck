'use client';

// The browser's half of `DeckApi` — P2-T2, and the twin of BrowserStreamTransport.
//
// It exists for the same two reasons that one does: so `DeckStore` can be unit-tested without a
// browser, and because the store's tests compile under the Node TypeScript project, which has no
// DOM lib at all. `fetch` is in both, but `Response` handling is the sort of thing that grows a
// DOM type the moment it grows a feature. The DOM stops here.
//
// **A non-2xx is a reply, not a failure.** Core refusing is an ordinary state the deck renders
// (RESEARCH.md F.3.3), so only a request that could not be made at all comes back `undefined` —
// and a body that is not JSON is `undefined` inside a reply that still carries its status, which
// is how a Next HTML error page stops looking like a session list.
import type { DeckApi, JsonReply } from './deck-api.ts';

export class BrowserDeckApi implements DeckApi {
  public async get(path: string): Promise<JsonReply | undefined> {
    return this.send(path, { headers: { accept: 'application/json' } });
  }

  public async post(path: string, body: unknown): Promise<JsonReply | undefined> {
    return this.send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async send(path: string, init: RequestInit): Promise<JsonReply | undefined> {
    try {
      // No credentials, no mode, no cache: same-origin defaults are what this needs, and naming
      // them would be the first step towards a cross-origin request that cannot work anyway.
      const response = await fetch(path, init);
      return { status: response.status, body: await readJson(response) };
    } catch {
      return undefined;
    }
  }
}

/** `undefined` for a body that is not JSON — an error page, or a 204 with nothing in it. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
