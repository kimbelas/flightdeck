// In-memory DeckApi — CODING-STANDARDS §10.1 (fakes, not mocks).
//
// It records every request and answers whatever the test queued, because the interesting cases are
// the ones a real core almost never produces: a 200 carrying an HTML error page, a 201 with no
// session id, a request that reaches nobody at all. Those are precisely the paths `DeckStore` used
// to cast straight into the page.
import type { DeckApi, JsonReply } from '../../app/deck/deck-api.ts';

export interface RecordedRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body: unknown;
}

export class FakeDeckApi implements DeckApi {
  public readonly requests: RecordedRequest[] = [];
  /** `undefined` means the request could not be made — a core that is not listening. */
  private next: JsonReply | undefined = undefined;

  public willAnswer(status: number, body: unknown): void {
    this.next = { status, body };
  }

  public willNotAnswer(): void {
    this.next = undefined;
  }

  public get(path: string): Promise<JsonReply | undefined> {
    this.requests.push({ method: 'GET', path, body: undefined });
    return Promise.resolve(this.next);
  }

  public post(path: string, body: unknown): Promise<JsonReply | undefined> {
    this.requests.push({ method: 'POST', path, body });
    return Promise.resolve(this.next);
  }
}
