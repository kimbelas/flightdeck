// Is core actually listening? (P1-T11, RESEARCH.md F.1.5.)
//
// A port because the answer must be provable in a unit test, and because the rule it serves is a
// business rule rather than a networking detail: Connect refuses to install hooks against a dead
// receiver, since every interactive session would then wear `Stop hook error occurred · ctrl+o to
// see` for every turn until somebody ran Disconnect.
//
// It must probe the port rather than infer health from anything else — F.1.5 measured that a
// headless session with a dead receiver is completely silent, so there is no behavioural signal to
// read.
export interface CoreHealth {
  /** True only if core answered. A refused connection, a timeout and a 401 are all false. */
  isRunning(): Promise<boolean>;
}
