// The daemon panel, as a class — P7-T4, CODING-STANDARDS §3 (React is the view).
//
// `ConnectPanelModel`'s shape, for its reason: what the panel shows is a fact about this tab and
// this minute, asked for by a press, so it stays out of `DeckState` — a seventh slice in a store at
// its line limit would buy nothing a local model does not.
import { parseDaemonReport, type DaemonReport } from '../../contracts/daemon-report.ts';
import { CORE_DAEMON_PATH } from '../../contracts/deck-routes.ts';
import type { DeckApi } from './deck-api.ts';
import { DaemonViewModel } from './daemon-view-model.ts';

export interface DaemonPanelState {
  readonly daemons: readonly DaemonViewModel[];
  /** When core took the reading — every age on the panel is measured from it, not from now. */
  readonly at: number | undefined;
  readonly error: string | undefined;
  readonly busy: boolean;
}

export const DAEMON_IDLE: DaemonPanelState = {
  daemons: [],
  at: undefined,
  error: undefined,
  busy: false,
};

export class DaemonPanelModel {
  private readonly api: DeckApi;

  constructor(api: DeckApi) {
    this.api = api;
  }

  /** One reading of both subscriptions. Never throws; a failure is an `error` to print. */
  public async load(): Promise<DaemonPanelState> {
    const reply = await this.api.get(CORE_DAEMON_PATH);
    if (reply === undefined) return { ...DAEMON_IDLE, error: 'could not reach core' };
    const report = reply.status === 200 ? parseDaemonReport(reply.body) : undefined;
    if (report === undefined) {
      return { ...DAEMON_IDLE, error: `core answered ${String(reply.status)}` };
    }
    return { ...DAEMON_IDLE, at: report.at, daemons: viewsOf(report) };
  }
}

function viewsOf(report: DaemonReport): readonly DaemonViewModel[] {
  return report.daemons.map((daemon) => new DaemonViewModel(daemon, report.at));
}
