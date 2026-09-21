// Can NODE load the modules core imports? — P6-T3, RESEARCH.md G.52.
//
// This file exists because a green suite and a core that would not boot happened on the same
// afternoon. `WindowsToastNotifier` had `import { notify } from 'toasted-notifier'`; eight unit
// tests imported the real library and passed; `flightdeck.cmd` then died at load with
// "does not provide an export named 'notify'".
//
// **Vitest is not Node.** It resolves and interops CommonJS through Vite, which synthesises the
// named exports Node's `cjs-module-lexer` refuses to detect. So importing a real dependency in a
// unit test proves the dependency is installed and the code around it runs — and proves nothing
// about whether the loader that actually starts core can load it.
//
// So this asks `node` directly, in a subprocess, which is the only thing that can answer. Each
// case is a `node --eval` that imports one adapter and nothing else: no fake, no wiring, no
// assertion about behaviour. Exit 0 is the whole assertion, and a non-zero one carries the loader's
// own message, which is the message that would otherwise have appeared in `.flightdeck-core.log`.
//
// **What belongs on the list**: any module under `core/` whose import graph reaches a third-party
// package. A module that imports only our own files cannot fail this way, and adding one would be
// paying a subprocess for nothing.
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/** The repository root, from this file. `tests/core/adapters` is three deep. */
const ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * Generous, because it pays for Node's start plus the module's own load.
 *
 * `node-pty` loads a native binding and `toasted-notifier` walks its vendor directory; neither is
 * fast, and a flaky timeout here would be worse than a slow test.
 */
const LOAD_TIMEOUT_MS = 30_000;

/** Every module under `core/` whose import graph reaches a package we do not own. */
const MODULES: readonly { readonly path: string; readonly package: string }[] = [
  { path: 'core/adapters/windows/windows-toast-notifier.ts', package: 'toasted-notifier' },
  { path: 'core/adapters/node-pty/node-pty-host.ts', package: 'node-pty' },
  { path: 'core/adapters/sqlite/sqlite-store.ts', package: 'node:sqlite' },
  { path: 'core/http/pty-socket-server.ts', package: 'ws' },
  // The composition root, which is what `flightdeck-core.ts` actually imports — so this one case
  // covers every adapter the others name and any that is added without this list being updated.
  { path: 'core/main.ts', package: 'all of them, through the composition root' },
];

describe('Node can load what core imports', () => {
  it.each(MODULES)('loads $path ($package)', async ({ path }) => {
    // A `file://` URL, not a Windows path: Node's ESM loader refuses `c:` as a URL scheme, which
    // is its own small trap and the reason this is spelled out rather than interpolated raw.
    const target = pathToFileURL(join(ROOT, path)).href;

    // Resolves only on exit 0. A load error rejects, and the loader's message is the failure.
    await expect(
      run(process.execPath, ['--eval', `import(${JSON.stringify(target)})`], {
        cwd: ROOT,
        timeout: LOAD_TIMEOUT_MS,
      }),
    ).resolves.toBeDefined();
  });
});
