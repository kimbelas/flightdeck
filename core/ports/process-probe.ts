// Is that pid still a process? — P5a-T4, RESEARCH.md F.2.16.
//
// One question, and it earns a port because the answer is the difference between a preview that
// arrives instantly and one that arrives after a two-second spawn that was never going to work.
// `daemon/roster.json` names a `supervisorPid`, and once the supervisor idle-exits the file keeps
// naming it — on this machine, for nine days — while `stop`, `rm` and `logs` all fail against the
// control pipe that is no longer there. A roster naming a dead pid is the SIGNATURE of that state
// and the only cheap way to see it.
//
// A port rather than a call, because the alternative in a test is owning a real process: proving
// "a dead supervisor routes the preview to the transcript" would mean spawning something and
// killing it, and then the test is about process lifetimes rather than about routing.
export interface ProcessProbe {
  /**
   * Whether a process with this id exists.
   *
   * @throws never. It says nothing about whose process it is or whether it is the supervisor the
   * roster meant — a pid can be reused, and a roster nine days old naming a pid that was reissued
   * reads as alive. That is accepted and it is why the caller falls back anyway when the command
   * it then runs fails: this is an optimisation with a correct path behind it, not an oracle.
   */
  isAlive(pid: number): boolean;
}
