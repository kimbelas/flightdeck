// `node scripts/hook-spike-cli.ts token`  → generate the spike token, print it, write the file
// `node scripts/hook-spike-cli.ts serve`  → run the receiver until SIGINT, one line per hook
//
// P0-T3. The token lives at %LOCALAPPDATA%\flightdeck\token, where flightdeck-core will keep the
// real per-boot token (SEC-HTTP-3). The ACL is P1-T12's job; this spike only needs the path.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HookReceiver, PayloadRecorder, type CapturedHook } from './hook-spike.ts';

const PORT = 4950;
const TOKEN_DIR = join(process.env['LOCALAPPDATA'] ?? process.cwd(), 'flightdeck');
const TOKEN_FILE = join(TOKEN_DIR, 'token');
const RAW_DIR = fileURLToPath(new URL('../fixtures/raw/hooks/', import.meta.url));

class HookSpikeCli {
  private readonly command: string;

  constructor(argv: readonly string[]) {
    this.command = argv[0] ?? 'serve';
  }

  private static writeToken(): number {
    mkdirSync(TOKEN_DIR, { recursive: true });
    const token = randomBytes(32).toString('hex');
    writeFileSync(TOKEN_FILE, token, 'utf8');
    console.log(token);
    return 0;
  }

  private static readToken(): string {
    return readFileSync(TOKEN_FILE, 'utf8').trim();
  }

  private static printCapture(hook: CapturedHook): void {
    console.log(
      `  ${hook.event.padEnd(16)} ack ${hook.ackMs.toFixed(2).padStart(6)} ms  ` +
        `${String(hook.bytes).padStart(6)} B  ${hook.file}`,
    );
  }

  private static printSummary(hooks: readonly CapturedHook[]): void {
    if (hooks.length === 0) {
      console.log('\nno hooks received');
      return;
    }
    const acks = [...hooks].map((hook) => hook.ackMs).sort((left, right) => left - right);
    const median = acks[Math.floor(acks.length / 2)] ?? 0;
    const worst = acks[acks.length - 1] ?? 0;
    console.log(
      `\n${String(hooks.length)} hooks — ack median ${median.toFixed(2)} ms, ` +
        `worst ${worst.toFixed(2)} ms (SEC-ING-2 budget: 5 ms)`,
    );
  }

  private static async serve(): Promise<number> {
    const recorder = new PayloadRecorder(RAW_DIR);
    const receiver = new HookReceiver(
      { port: PORT, token: HookSpikeCli.readToken(), outputDir: RAW_DIR },
      recorder,
      (hook) => {
        HookSpikeCli.printCapture(hook);
      },
    );

    await receiver.start();
    console.log(`listening on http://127.0.0.1:${String(PORT)}/hooks  →  ${RAW_DIR}`);

    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });

    await receiver.stop();
    HookSpikeCli.printSummary(receiver.captured());
    return 0;
  }

  public async run(): Promise<number> {
    switch (this.command) {
      case 'token':
        return HookSpikeCli.writeToken();
      case 'serve':
        return await HookSpikeCli.serve();
      default:
        console.error(`unknown command ${this.command}; expected "token" or "serve"`);
        return 1;
    }
  }
}

process.exitCode = await new HookSpikeCli(process.argv.slice(2)).run();
