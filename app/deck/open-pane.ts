// One card in the grid: its React key, what its head says, and what it is attached to.
//
// A module of its own, as of P6-T1, and the reason is the tests. It lived in `deck-view.tsx`,
// which is a `.tsx` and therefore outside the unit project's tsconfig — so a test that touched an
// `OpenPane` got `any`, and the lint rules that exist to catch exactly that fired instead of the
// type doing its job. Moving it into `use-pane-grid.ts` only traded the problem for another one:
// that module reads `window`, and the unit project has no DOM lib.
//
// So it is a leaf: one interface, no imports but the contract it carries, nothing to resolve.
import type { PtyTarget } from '../../contracts/pty-protocol.ts';

export interface OpenPane {
  readonly key: string;
  readonly title: string;
  readonly target: PtyTarget;
}
