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
  /**
   * Answers for one path, which the default below cannot express — P3-T1.
   *
   * One store call now makes two requests: `importProject` POSTs and then re-reads the registry,
   * and a single queued reply would answer both, so a 201 for the import would arrive as a 201 for
   * the list and be dropped. A path is enough to tell them apart; a general request matcher would
   * be a mocking library, which §10.1 does not use.
   */
  private readonly byPath = new Map<string, JsonReply>();
  /** `undefined` means the request could not be made — a core that is not listening. */
  private next: JsonReply | undefined = undefined;

  public willAnswer(status: number, body: unknown): void {
    this.next = { status, body };
  }

  /** Queued for this path only, and consulted before the default. Survives repeated calls. */
  public willAnswerPath(path: string, status: number, body: unknown): void {
    this.byPath.set(path, { status, body });
  }

  public willNotAnswer(): void {
    this.next = undefined;
    this.byPath.clear();
  }

  public get(path: string): Promise<JsonReply | undefined> {
    this.requests.push({ method: 'GET', path, body: undefined });
    return Promise.resolve(this.answerFor(path));
  }

  public post(path: string, body: unknown): Promise<JsonReply | undefined> {
    this.requests.push({ method: 'POST', path, body });
    return Promise.resolve(this.answerFor(path));
  }

  private answerFor(path: string): JsonReply | undefined {
    return this.byPath.get(path) ?? this.next;
  }
}
