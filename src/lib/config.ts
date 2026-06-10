import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ConfigError } from "./errors.js";

export const AgentBackend = z.enum(["claude", "codex"]);
export type AgentBackend = z.infer<typeof AgentBackend>;

export const ConfigSchema = z.object({
  defaultAgent: AgentBackend.default("claude"),
  models: z
    .object({
      reconstruct: z.string().default("claude-opus-4-8"),
      localize: z.string().default("claude-opus-4-8"),
      fix: z.string().default("claude-opus-4-8"),
    })
    .default({
      reconstruct: "claude-opus-4-8",
      localize: "claude-opus-4-8",
      fix: "claude-opus-4-8",
    }),
  testCommand: z.string().min(1),
  setupCommand: z.string().optional(),
  reproTimeoutMs: z.number().int().positive().default(120_000),
  suiteTimeoutMs: z.number().int().positive().default(600_000),
  bisect: z
    .object({
      maxCommits: z.number().int().positive().default(500),
      good: z.string().optional(),
      bad: z.string().default("HEAD"),
    })
    .default({ maxCommits: 500, bad: "HEAD" }),
  fix: z
    .object({
      candidates: z.number().int().positive().max(16).default(3),
      concurrency: z.number().int().positive().max(16).default(3),
    })
    .default({ candidates: 3, concurrency: 3 }),
  maxThinkingTokens: z.number().int().positive().default(16_000),
}).strict();

export type ReplayConfig = z.infer<typeof ConfigSchema>;

export const DOT_DIR = ".replay";
export const CONFIG_FILE = "replay.config.json";
export const INFO_FILE = "INFO.md";

export interface LoadedConfig {
  config: ReplayConfig;
  root: string;
  dotDir: string;
  dataDir: string;
  info: string;
}

export function resolveDotDir(root: string): string {
  return join(root, DOT_DIR);
}

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const dotDir = resolveDotDir(root);
  const configPath = join(dotDir, CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new ConfigError(
      `no replay project found at ${root}`,
      `run "replay init" in the repository root first`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (cause) {
    throw new ConfigError(
      `${CONFIG_FILE} is not valid JSON: ${(cause as Error).message}`,
      `fix the syntax in ${configPath}`,
    );
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`invalid ${CONFIG_FILE}: ${detail}`, `edit ${configPath}`);
  }

  const infoPath = join(dotDir, INFO_FILE);
  const info = existsSync(infoPath) ? await readFile(infoPath, "utf8") : "";

  return {
    config: parsed.data,
    root,
    dotDir,
    dataDir: join(dotDir, "data"),
    info,
  };
}

export function defaultConfig(testCommand: string): ReplayConfig {
  return ConfigSchema.parse({ testCommand });
}
