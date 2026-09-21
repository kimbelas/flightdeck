// `GET /projects/observed?path=…` — what Claude actually did in one folder (P3-T5, SPEC §5.1(b)).
//
// **One project per request, unlike its three neighbours**, and the reason is cost rather than
// taste. `/projects/status` and `/projects/map` answer for every imported folder at once because
// each is milliseconds; this one reads every transcript of a folder in both subscriptions — 83.7 MB
// and 1 149 ms for this repository's own, and 423 MB in 9 933 ms for the biggest project on this
// machine. Answering for every project at once would be that, times the registry, on one request.
//
// **The path is matched against the REGISTRY, never used as one.** It arrives as a query parameter
// and is looked up among the imported folders; a path nobody imported is a 404 and never a read.
// That is `ProjectRegistry`'s rule (D26, SEC-FS-1) and it is what stops this route being a way to
// ask core to read an arbitrary directory of a config dir.
import type { ObservedBehaviour } from '../../contracts/observed-behaviour.ts';
import type { ProjectRecord } from '../../contracts/project.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/**
 * What this route needs.
 *
 * Two methods, both narrow, for `ProjectStatusSource`'s reason: a test of "an unimported path is a
 * 404" should not have to own a filesystem, a read policy and two config directories.
 */
export interface ObservedSource {
  /** The imported folder with this path, or `undefined`. The registry's answer, not a guess. */
  find(path: string): ProjectRecord | undefined;
  read(project: ProjectRecord): Promise<ObservedBehaviour>;
}

export class ObservedRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/projects/observed';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly source: ObservedSource;

  constructor(source: ObservedSource) {
    this.source = source;
  }

  public async handle(facts: RequestFacts): Promise<JsonResponse> {
    const asked = pathIn(facts.url);
    if (asked === undefined) return json(400, { error: 'bad request' });
    const project = this.source.find(asked);
    // 404 rather than 403: the answer to "what happened in a folder I never imported" is that
    // there is nothing here to report, and a different status would confirm what is on the disk.
    if (project === undefined) return json(404, { error: 'not imported' });
    return json(200, await this.source.read(project));
  }
}

/** `?path=` — the stored path of an imported folder, and nothing is composed from it here. */
function pathIn(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const asked = new URL(url, 'http://127.0.0.1').searchParams.get('path');
  return asked === null || asked === '' ? undefined : asked;
}
