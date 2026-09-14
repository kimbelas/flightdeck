// What the store needs from the network, as a port — P2-T2.
//
// The store had none: it called `fetch` directly, which made two of its three code paths
// untestable and, worse, invisible. The stream path parses every frame and drops what does not
// match (CODING-STANDARDS §11 rule 1); the fetch paths cast the JSON and rendered it. Both carry
// the same rows from the same core, and only one of them was checking.
//
// A transport, not a client: it knows about status codes and JSON and nothing about sessions. The
// store owns what a reply means, because that is the part worth testing.
//
// **Same-origin only.** Every path handed to this port is relative, so it rides the rewrite and
// the token stays server-side (SEC-HTTP-5). The port cannot be given an origin and no adapter
// should accept one.

/** One answer from the deck's own server. `body` is `unknown` until a parser accepts it. */
export interface JsonReply {
  readonly status: number;
  readonly body: unknown;
}

export interface DeckApi {
  /** @returns `undefined` when the request could not be made at all — no reply, not an error one. */
  get(path: string): Promise<JsonReply | undefined>;
  post(path: string, body: unknown): Promise<JsonReply | undefined>;
}
