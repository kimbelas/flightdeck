// The Task Scheduler XML, as a pure function — SEC-OPS-3, D21 (P1-T12).
//
// Separated from the adapter that registers it so the two SEC-OPS-3 promises are provable without
// touching the machine's task store: **run only when the user is logged on** (`InteractiveToken`,
// and no `<UserId>` password principal) and **never elevated** (`LeastPrivilege`). A test asserts
// both, because they are the kind of thing that is easy to lose in a hand-edited XML file and
// impossible to notice afterwards.
//
// **Why the action is `cmd.exe /c … > log`.** A task action cannot redirect output, and a core
// started at logon with nowhere to write is a core whose log does not exist — which removes the
// one record that survives the browser being closed (P1-T9). `cmd` is the only thing on a stock
// Windows that can redirect, so it is what the action runs, with a command string this file
// builds entirely from paths it was given. Nothing user-supplied or model-supplied reaches it.
//
// **The console window is the price of SEC-OPS-3, not an oversight.** A task that runs "whether
// the user is logged on or not" has no window — and needs stored credentials, which SEC-OPS-3
// forbids. So there is a `cmd` window at logon. Minimising it needs a shell verb that detaches the
// process, which would leave Task Scheduler tracking a wrapper that has already exited.

/** One name, so `doctor`, the installer and anything an operator types agree (Task Scheduler). */
export const LOGON_TASK_NAME = 'Flightdeck Core';

export interface LogonTaskDefinitionParts {
  /** The current user, as `DOMAIN\account` — what the trigger and the principal both name. */
  readonly account: string;
  /** `process.execPath` — node by absolute path, because a task's PATH is not the shell's. */
  readonly nodePath: string;
  /** The entry point, absolute: `…\scripts\flightdeck-core.ts`. */
  readonly scriptPath: string;
  /** The repo root. Also where the log lands, next to the one `flightdeck.cmd` writes. */
  readonly workingDirectory: string;
  readonly logPath: string;
}

/** The action's command string, exported so the installer can print the one line that matters. */
export function logonTaskCommand(parts: LogonTaskDefinitionParts): string {
  return `/c "${parts.nodePath}" "${parts.scriptPath}" > "${parts.logPath}" 2>&1`;
}

/**
 * Directories whose contents are gone by the next logon. A task pointing into one never starts.
 *
 * **Found by running the installer's dry run, not by thinking about it.** `process.execPath` on
 * this machine is
 * `…\AppData\Local\fnm_multishells\26232_1789387346814\node.exe` — fnm gives every shell its own
 * directory, named after that shell's pid, and deletes it with the shell. A logon task built from
 * `process.execPath` would therefore have failed silently at every logon, forever, with the only
 * symptom being that hooks have no receiver. `realpathSync` resolves the shim to the real
 * installation, which is what the installer registers.
 */
const EPHEMERAL_MARKERS: readonly string[] = ['fnm_multishells', 'nvm_multishells', '\\Temp\\'];

/**
 * The ephemeral directory named somewhere in this text, or `undefined`.
 *
 * Takes any text so both callers can use it: the installer passes the node path it is about to
 * register and refuses, and `doctor` passes the whole definition of a task that is already
 * registered. Fail closed in both — a task pointing at a path that will not exist is worse than
 * no task, because "registered" is what an operator reads as "the receiver is guaranteed".
 */
export function ephemeralDirectory(text: string): string | undefined {
  const lowered = text.toLowerCase();
  return EPHEMERAL_MARKERS.find((marker) => lowered.includes(marker.toLowerCase()));
}

/**
 * The whole registration, as Task Scheduler's own XML.
 *
 * `ExecutionTimeLimit PT0S` is the one setting worth naming: the default is 72 hours, after which
 * Task Scheduler would stop a service that is behaving perfectly. The battery settings are the
 * second — the default refuses to start on battery, which on a laptop means no hook receiver
 * whenever it is unplugged.
 */
export function logonTaskDefinition(parts: LogonTaskDefinitionParts): string {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    whoAndWhen(escapeXml(parts.account)),
    SETTINGS,
    action(parts),
    '</Task>',
  ].join('\n');
}

/** The registration, the logon trigger and the principal — the SEC-OPS-3 half. */
function whoAndWhen(account: string): string {
  return `  <RegistrationInfo>
    <Description>Flightdeck core — the hook and statusLine receiver for every Claude Code session on this machine. Starts at logon so a session never posts to a dead receiver (DECISIONS.md D21).</Description>
    <URI>\\${escapeXml(LOGON_TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${account}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${account}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>`;
}

/** No interpolation, so it is a constant: every value here is a decision, not an input. */
const SETTINGS = `  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>`;

function action(parts: LogonTaskDefinitionParts): string {
  return `  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(cmdPath())}</Command>
      <Arguments>${escapeXml(logonTaskCommand(parts))}</Arguments>
      <WorkingDirectory>${escapeXml(parts.workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>`;
}

/** By absolute path, for the reason icacls is: a PATH entry must not decide what runs. */
function cmdPath(): string {
  return `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\cmd.exe`;
}

/**
 * XML escaping, on every interpolated value.
 *
 * A Windows account or a repo path containing `&` is unusual and entirely legal, and the failure
 * it would cause — a task definition Task Scheduler refuses, or worse accepts differently from
 * what was shown in the dry run — is exactly the class of bug this project fixes with a test
 * rather than with care.
 */
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
