// `realpath` plus `stat`, and the two measurements behind which `realpath` — P3-T1, SEC-FS-1.
//
// **`fsPromises.realpath` and not `realpathSync.native`**, which is the pairing this file was
// first written with and which does not exist: `.native` is on the callback and sync APIs only
// (`fs.realpath.native`, `fs.realpathSync.native`) and `fsPromises.realpath.native` is `undefined`
// on Node 26.3.0. So the choice was the sync native call inside an async adapter, or the async JS
// one — and the reason to want `.native` at all is that it asks Windows for the final path by
// handle, where the JS implementation walks the components itself.
//
// **Measured on this machine rather than assumed**, because the junction case is the whole point.
// Against a real `mklink /J` junction, `fsPromises.realpath`, `fs.realpathSync` and
// `fs.realpathSync.native` returned the same resolved path outside the root, and all three folded
// `…\ROOT` back to `…\root`. The async JS call therefore buys the same two guarantees SEC-FS-1
// needs — junctions resolved, casing settled — without a synchronous syscall on the request path.
// `tests/win/project-junction.test.ts` is where that stops being a claim in a comment.
//
// **`stat` on the RESOLVED path, never on the argument.** Statting what the caller passed would
// answer about the link rather than about its target, which is the same class of mistake as
// checking a path and then opening a different one (`FsJobFiles`, and the CodeQL finding that made
// it open first). There is still a window between the two calls — the folder can be replaced in
// it — and it is accepted here rather than hidden: an import is a deliberate act by the owner on
// their own machine, and what is stored is the path `realpath` returned, which is re-screened by
// `ReadPolicy` before anything under it is ever opened.
import { realpath, stat } from 'node:fs/promises';
import type { CanonicalPath, PathCanonicaliser } from '../../ports/path-canonicaliser.ts';

export class FsPathCanonicaliser implements PathCanonicaliser {
  /** @throws never — every failure, absence included, is `undefined` (the port says why). */
  public async canonicalise(path: string): Promise<CanonicalPath | undefined> {
    try {
      const resolved = await realpath(path);
      return { path: resolved, isDirectory: (await stat(resolved)).isDirectory() };
    } catch {
      // No such folder, no permission, an unmapped drive letter. All three are the owner having
      // typed a path that is not there, which is a refusal to render and not an error to throw.
      return undefined;
    }
  }
}
