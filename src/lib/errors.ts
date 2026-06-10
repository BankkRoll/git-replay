export class ReplayError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "ReplayError";
    this.code = code;
    this.hint = hint;
  }
}

export class AuthError extends ReplayError {
  constructor(message: string, hint?: string) {
    super("AUTH", message, hint);
    this.name = "AuthError";
  }
}

export class QuotaError extends ReplayError {
  constructor(message: string, hint?: string) {
    super("QUOTA", message, hint);
    this.name = "QuotaError";
  }
}

export class GateError extends ReplayError {
  readonly gate: string;

  constructor(gate: string, message: string, hint?: string) {
    super("GATE", message, hint);
    this.name = "GateError";
    this.gate = gate;
  }
}

export class ConfigError extends ReplayError {
  constructor(message: string, hint?: string) {
    super("CONFIG", message, hint);
    this.name = "ConfigError";
  }
}

export class GitError extends ReplayError {
  constructor(message: string, hint?: string) {
    super("GIT", message, hint);
    this.name = "GitError";
  }
}

export function isReplayError(value: unknown): value is ReplayError {
  return value instanceof ReplayError;
}
