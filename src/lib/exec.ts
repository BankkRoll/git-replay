import { execa } from "execa";

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunOutcome {
  passed: boolean;
  exitCode: number;
  output: string;
  timedOut: boolean;
}

export async function runCommand(command: string, options: RunOptions): Promise<RunOutcome> {
  if (!command.trim()) {
    return { passed: false, exitCode: 1, output: "empty command", timedOut: false };
  }
  const result = await execa(command, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    shell: true,
    reject: false,
    all: true,
    env: options.env,
  });
  const output = (result.all ?? `${result.stdout ?? ""}\n${result.stderr ?? ""}`).trim();
  const timedOut = result.timedOut === true;
  const exitCode = result.exitCode ?? (timedOut ? 124 : 1);
  return {
    passed: exitCode === 0 && !timedOut,
    exitCode,
    output,
    timedOut,
  };
}
