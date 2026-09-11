// `node scripts/roadmap-cli.ts`          → progress report
// `node scripts/roadmap-cli.ts --check`  → validate; exit 1 on errors (used by CI)
import { RoadmapLoader, RoadmapReporter, RoadmapValidator, type Finding } from './roadmap.ts';

const ROADMAP_URL = new URL('../ROADMAP.yaml', import.meta.url);

class RoadmapCli {
  private readonly checkOnly: boolean;

  constructor(argv: readonly string[]) {
    this.checkOnly = argv.includes('--check');
  }

  private static bar(done: number, total: number): string {
    const width = 12;
    const filled = total === 0 ? 0 : Math.round((done / total) * width);
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
  }

  public run(): number {
    const roadmap = new RoadmapLoader().load(ROADMAP_URL);
    const findings = new RoadmapValidator(roadmap).validate();
    this.printFindings(findings);
    const errors = findings.filter((finding) => finding.level === 'error').length;
    if (this.checkOnly) {
      console.log(
        errors === 0 ? 'ROADMAP.yaml: valid' : `ROADMAP.yaml: ${String(errors)} error(s)`,
      );
      return errors === 0 ? 0 : 1;
    }
    this.printProgress(new RoadmapReporter(roadmap));
    return errors === 0 ? 0 : 1;
  }

  private printFindings(findings: readonly Finding[]): void {
    for (const finding of findings) {
      console.log(`${finding.level === 'error' ? 'ERROR' : 'warn '}  ${finding.message}`);
    }
  }

  private printProgress(reporter: RoadmapReporter): void {
    console.log(`\nflightdeck roadmap — ${String(reporter.overallPercent())}% of tasks done\n`);
    for (const phase of reporter.phases()) {
      const bar = RoadmapCli.bar(phase.done, phase.total);
      console.log(
        `  ${phase.id.padEnd(4)} ${bar} ${String(phase.done).padStart(2)}/${String(phase.total).padEnd(2)} ${phase.status.padEnd(7)} ${phase.name}`,
      );
    }
    const next = reporter.nextUp();
    if (next.length > 0) {
      console.log('\nnext up');
      for (const task of next)
        console.log(`  ${task.id.padEnd(7)} ${task.status.padEnd(6)} ${task.title}`);
    }
    const blocked = reporter.blocked();
    if (blocked.length > 0) {
      console.log('\nblocked on a decision');
      for (const task of blocked)
        console.log(`  ${task.id.padEnd(7)} ${task.title} ← ${(task.depends_on ?? []).join(', ')}`);
    }
    console.log('');
  }
}

process.exitCode = new RoadmapCli(process.argv.slice(2)).run();
