import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AuthError } from "./errors.js";
import { logger } from "./logger.js";
import type { AgentBackend } from "./config.js";

const GATEWAY_BASE = "https://ai-gateway.vercel.sh/v1";
const ANTHROPIC_DIRECT = "https://api.anthropic.com";

export type CredentialSource =
  | "explicit-anthropic"
  | "explicit-openai"
  | "gateway-key"
  | "gateway-oidc"
  | "subscription-claude"
  | "subscription-codex";

export interface ResolvedCredential {
  source: CredentialSource;
  backend: AgentBackend;
  delegated: boolean;
  anthropicBaseUrl: string;
  anthropicAuthToken: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
}

interface RawCredentials {
  anthropicAuthToken?: string;
  anthropicBaseUrl?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  gatewayKey?: string;
  oidcToken?: string;
}

function readEnvCredentials(env: NodeJS.ProcessEnv): RawCredentials {
  return {
    anthropicAuthToken: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    gatewayKey: env.AI_GATEWAY_API_KEY,
    oidcToken: env.VERCEL_OIDC_TOKEN,
  };
}

export async function applyDotEnvLocal(root: string): Promise<void> {
  const file = await readDotEnvLocal(root);
  for (const [key, value] of Object.entries(file)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function readDotEnvLocal(root: string): Promise<Record<string, string>> {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  const raw = await readFile(path, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function merge(env: NodeJS.ProcessEnv, file: Record<string, string>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(file)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

export interface ResolveOptions {
  allowSubscription?: boolean;
}

export async function resolveCredential(
  backend: AgentBackend,
  root: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: ResolveOptions = {},
): Promise<ResolvedCredential> {
  const allowSubscription = options.allowSubscription ?? true;
  const fileEnv = await readDotEnvLocal(root);
  const env = merge(baseEnv, fileEnv);
  const raw = readEnvCredentials(env);

  if (backend === "claude" && raw.anthropicAuthToken && raw.anthropicBaseUrl) {
    return frame("explicit-anthropic", backend, {
      anthropicAuthToken: raw.anthropicAuthToken,
      anthropicBaseUrl: raw.anthropicBaseUrl,
      openaiApiKey: raw.openaiApiKey ?? raw.anthropicAuthToken,
      openaiBaseUrl: raw.openaiBaseUrl ?? GATEWAY_BASE,
    });
  }

  if (backend === "claude" && raw.anthropicAuthToken) {
    return frame("explicit-anthropic", backend, {
      anthropicAuthToken: raw.anthropicAuthToken,
      anthropicBaseUrl: ANTHROPIC_DIRECT,
      openaiApiKey: raw.openaiApiKey ?? raw.anthropicAuthToken,
      openaiBaseUrl: raw.openaiBaseUrl ?? GATEWAY_BASE,
    });
  }

  if (backend === "codex" && raw.openaiApiKey) {
    return frame("explicit-openai", backend, {
      anthropicAuthToken: raw.anthropicAuthToken ?? raw.openaiApiKey,
      anthropicBaseUrl: raw.anthropicBaseUrl ?? GATEWAY_BASE,
      openaiApiKey: raw.openaiApiKey,
      openaiBaseUrl: raw.openaiBaseUrl ?? GATEWAY_BASE,
    });
  }

  if (raw.gatewayKey) {
    return frame("gateway-key", backend, {
      anthropicAuthToken: raw.gatewayKey,
      anthropicBaseUrl: GATEWAY_BASE,
      openaiApiKey: raw.gatewayKey,
      openaiBaseUrl: GATEWAY_BASE,
    });
  }

  if (raw.oidcToken) {
    return frame("gateway-oidc", backend, {
      anthropicAuthToken: raw.oidcToken,
      anthropicBaseUrl: GATEWAY_BASE,
      openaiApiKey: raw.oidcToken,
      openaiBaseUrl: GATEWAY_BASE,
    });
  }

  if (allowSubscription && backend === "claude" && hasClaudeSession()) {
    warnSubscription("claude");
    return delegated("subscription-claude", backend);
  }

  if (allowSubscription && backend === "codex" && hasCodexSession()) {
    warnSubscription("codex");
    return delegated("subscription-codex", backend);
  }

  throw new AuthError(
    "no usable credential found",
    'set ANTHROPIC_AUTH_TOKEN, AI_GATEWAY_API_KEY, run "npx vercel env pull" for an OIDC token, or "claude login" / "codex login"',
  );
}

function hasClaudeSession(): boolean {
  return existsSync(join(homedir(), ".claude", ".credentials.json"));
}

function hasCodexSession(): boolean {
  return existsSync(join(homedir(), ".codex", "auth.json"));
}

let subscriptionWarned = false;
function warnSubscription(backend: AgentBackend): void {
  if (subscriptionWarned) return;
  subscriptionWarned = true;
  logger.warn(
    `using local ${backend} subscription session — fine for evaluation, but subscriptions lack the capacity for sustained runs; set AI_GATEWAY_API_KEY for real use`,
  );
}

function frame(
  source: CredentialSource,
  backend: AgentBackend,
  parts: {
    anthropicAuthToken: string;
    anthropicBaseUrl: string;
    openaiApiKey: string;
    openaiBaseUrl: string;
  },
): ResolvedCredential {
  return { source, backend, delegated: false, ...parts };
}

function delegated(source: CredentialSource, backend: AgentBackend): ResolvedCredential {
  return {
    source,
    backend,
    delegated: true,
    anthropicAuthToken: "",
    anthropicBaseUrl: "",
    openaiApiKey: "",
    openaiBaseUrl: "",
  };
}

export function applyCredential(
  cred: ResolvedCredential,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (cred.delegated) return { ...env };
  return {
    ...env,
    ANTHROPIC_AUTH_TOKEN: cred.anthropicAuthToken,
    ANTHROPIC_BASE_URL: cred.anthropicBaseUrl,
    OPENAI_API_KEY: cred.openaiApiKey,
    OPENAI_BASE_URL: cred.openaiBaseUrl,
  };
}

export function describeCredential(cred: ResolvedCredential): string {
  const labels: Record<CredentialSource, string> = {
    "explicit-anthropic": "explicit Anthropic key",
    "explicit-openai": "explicit OpenAI key",
    "gateway-key": "Vercel AI Gateway key",
    "gateway-oidc": "Vercel OIDC token",
    "subscription-claude": "local Claude subscription",
    "subscription-codex": "local Codex subscription",
  };
  return labels[cred.source];
}
