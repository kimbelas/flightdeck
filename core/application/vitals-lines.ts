// `VitalsRegistry` → the one row shape anything outside core reads — P2-T3.
//
// It was a private method on `StatusReport` until the deck's header needed the same rows
// (contracts/quota-summary.ts). Copying five lines would have been shorter and would have been the
// bug: `GET /status` and the `quota` frame would then each have their own opinion about which
// fields of a `StatuslineReport` are publishable, and the two would drift the first time one of
// them grew a field. There is one projection, and this is it.
//
// **What it drops is the point.** `StatuslineReport` carries `transcriptPath`, which names the
// account and the project folder; `SessionVitalsLine` does not, on either route (SEC-DATA-2). A
// projection that is used twice is also a boundary that is enforced twice.
import type { SessionVitalsLine } from '../../contracts/core-status.ts';
import type { VitalsRegistry } from './vitals-registry.ts';

/** Newest-updated last, as `VitalsRegistry` keeps them — every reader decides its own order. */
export function vitalsLines(registry: VitalsRegistry): readonly SessionVitalsLine[] {
  return registry.all().map((entry) => ({
    sessionId: entry.report.sessionId,
    subscription: entry.subscription,
    at: entry.at,
    sessionName: entry.report.sessionName,
    modelName: entry.report.modelName,
    claudeVersion: entry.report.claudeVersion,
    usedPercentage: entry.report.usedPercentage,
    costUsd: entry.report.costUsd,
    fiveHourPercentage: entry.report.fiveHour.usedPercentage,
    fiveHourResetsAt: entry.report.fiveHour.resetsAt,
    sevenDayPercentage: entry.report.sevenDay.usedPercentage,
    sevenDayResetsAt: entry.report.sevenDay.resetsAt,
  }));
}
