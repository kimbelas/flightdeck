// `GET /search/tools` — which tools the tool filter can offer (P7-T2, SPEC §5.8).
//
// Its own route rather than a field on every search reply: the list changes when a tool is first
// called, not per keystroke, so the deck reads it once when the search panel opens.
//
// **Names only**, most widely used first (contracts/transcript-tools.ts). What is offered is what
// the index can answer: a picker listing a tool nobody called would be a filter with no hits.
import { MAX_TOOL_NAMES } from '../../contracts/transcript-tools.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one method this route needs from the store. */
export interface TranscriptToolList {
  transcriptTools(limit: number): readonly string[];
}

export class SearchToolsRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/search/tools';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly index: TranscriptToolList;

  constructor(index: TranscriptToolList) {
    this.index = index;
  }

  /** @returns 200 and `{ tools }` — an empty list before anything is indexed. */
  public handle(): Promise<JsonResponse> {
    return Promise.resolve(json(200, { tools: this.index.transcriptTools(MAX_TOOL_NAMES) }));
  }
}
