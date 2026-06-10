import pc from "picocolors";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private enabled(level: LogLevel): boolean {
    return ORDER[level] <= ORDER[this.level];
  }

  error(message: string): void {
    if (this.enabled("error")) process.stderr.write(`${pc.red("✗")} ${message}\n`);
  }

  warn(message: string): void {
    if (this.enabled("warn")) process.stderr.write(`${pc.yellow("!")} ${message}\n`);
  }

  info(message: string): void {
    if (this.enabled("info")) process.stdout.write(`${message}\n`);
  }

  success(message: string): void {
    if (this.enabled("info")) process.stdout.write(`${pc.green("✓")} ${message}\n`);
  }

  step(label: string, message: string): void {
    if (this.enabled("info")) process.stdout.write(`${pc.cyan(`[${label}]`)} ${message}\n`);
  }

  debug(message: string): void {
    if (this.enabled("debug")) process.stderr.write(`${pc.dim(`· ${message}`)}\n`);
  }

  hint(message: string): void {
    if (this.enabled("error")) process.stderr.write(`  ${pc.dim("→")} ${pc.dim(message)}\n`);
  }
}

export const logger = new Logger();
