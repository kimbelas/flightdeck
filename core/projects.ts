// The project side of the composition root — `feeds.ts` and `reads.ts`'s third sibling (P3-T1).
//
// Split out for the reason those two were: `main.ts` is a file with a line limit and of what it
// does, this is a piece with a story of its own. The feeds are what NOTICES things, `reads.ts` is
// what ANSWERS a question about one of them, and this is what decides WHERE core is allowed to
// look at all.
//
// **It constructs the only `PathCanonicaliser` there is**, which is the reason this cannot live in
// the domain or the application layer: `realpath` is a syscall, the rule it feeds is pure string
// work, and the seam between them is exactly here (CODING-STANDARDS §2).
//
// **Nothing here reads a project.** The registry ships empty (D26), and until the owner imports a
// folder in the deck there is no root, no widened `ReadPolicy` and nothing on disk for P3-T3 to
// open. That is the design and not a gap.
import { ProjectRegistry } from './application/project-registry.ts';
import type { AuditLog } from './application/audit-log.ts';
import { FsPathCanonicaliser } from './adapters/node/fs-path-canonicaliser.ts';
import type { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { SUBSCRIPTION_IDS } from '../contracts/session.ts';
import { ForgetProjectRoute } from './http/forget-project-route.ts';
import { ImportProjectRoute } from './http/import-project-route.ts';
import { ProjectsRoute } from './http/projects-route.ts';
import type { Route } from './http/route.ts';
import type { Clock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';
import type { Store } from './ports/store.ts';

export interface ProjectParts {
  readonly install: ClaudeInstall;
  readonly store: Store;
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The registry, loaded with whatever was imported before this boot.
 *
 * The config directories are passed as data rather than as `ClaudeInstall`, the way every inward
 * layer in core takes them, and they are here for one reason that is easy to misread: the registry
 * needs them to REFUSE, not to read. A folder that is a config directory — or that contains one —
 * cannot become a project (`ProjectImport`), and `ReadPolicy` screens anything under one by the
 * config-directory rules whatever else contains it.
 */
export function buildProjectRegistry(parts: ProjectParts): ProjectRegistry {
  return new ProjectRegistry({
    store: parts.store,
    paths: new FsPathCanonicaliser(),
    configDirs: SUBSCRIPTION_IDS.map((id) => parts.install.configDirFor(id)),
    audit: parts.audit,
    clock: parts.clock,
    logger: parts.logger,
  });
}

/**
 * The three routes over one registry, as a list `main.ts` can spread into the router.
 *
 * Here rather than in `main.ts` for a reason that is more than tidiness: the router table is the
 * one list in the composition root that grows with every phase, and `main.ts` reached its line
 * limit adding these three. A slice that owns a registry may as well own the routes onto it, which
 * is the same division `feeds.ts` made for the stream route.
 *
 * One registry for all three, deliberately: a second would hold a second copy of the roots, and
 * "which folders may be read" is not a question two objects may answer differently.
 */
export function projectRoutes(parts: ProjectParts): readonly Route[] {
  const registry = buildProjectRegistry(parts);
  return [
    new ProjectsRoute(registry),
    new ImportProjectRoute(registry),
    new ForgetProjectRoute(registry),
  ];
}
