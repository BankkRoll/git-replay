import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

import { ReplayError } from "./errors.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const StageName = z.enum(["reconstruct", "bisect", "localize", "fix"]);
export type StageName = z.infer<typeof StageName>;

export const ReproArtifact = z.object({
  testPath: z.string(),
  testSource: z.string(),
  command: z.string(),
  failingOutput: z.string(),
});
export type ReproArtifact = z.infer<typeof ReproArtifact>;

export const BisectArtifact = z.object({
  introducedAt: z.string(),
  author: z.string(),
  date: z.string(),
  subject: z.string(),
  log: z.string(),
});
export type BisectArtifact = z.infer<typeof BisectArtifact>;

export const LocalizeArtifact = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  rootCause: z.string(),
  evidence: z.string(),
});
export type LocalizeArtifact = z.infer<typeof LocalizeArtifact>;

export const FixArtifact = z.object({
  patch: z.string(),
  reproPassed: z.boolean(),
  suitePassed: z.boolean(),
  candidateIndex: z.number().int().nonnegative(),
});
export type FixArtifact = z.infer<typeof FixArtifact>;

export const RunState = z.object({
  id: z.string(),
  bug: z.string(),
  createdAt: z.string(),
  backend: z.enum(["claude", "codex"]),
  reconstruct: ReproArtifact.optional(),
  bisect: BisectArtifact.optional(),
  localize: LocalizeArtifact.optional(),
  fix: FixArtifact.optional(),
});
export type RunState = z.infer<typeof RunState>;

export function runId(bug: string, head: string): string {
  return createHash("sha256")
    .update(`${head}\n${bug}`)
    .digest("hex")
    .slice(0, 12);
}

export class CheckpointStore {
  private readonly dir: string;
  private readonly statePath: string;

  constructor(dataDir: string, id: string) {
    this.dir = join(dataDir, id);
    this.statePath = join(this.dir, "state.json");
  }

  get runDir(): string {
    return this.dir;
  }

  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  exists(): boolean {
    return existsSync(this.statePath);
  }

  async load(): Promise<RunState> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.statePath, "utf8"));
    } catch (cause) {
      throw new ReplayError(
        "CHECKPOINT",
        `run state at ${this.statePath} is corrupt: ${(cause as Error).message}`,
        "delete the run directory to start fresh",
      );
    }
    const parsed = RunState.safeParse(raw);
    if (!parsed.success) {
      throw new ReplayError(
        "CHECKPOINT",
        `run state at ${this.statePath} has an unexpected shape`,
        "delete the run directory to start fresh",
      );
    }
    return parsed.data;
  }

  async save(state: RunState): Promise<void> {
    await this.ensure();
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
      await rename(tmp, this.statePath);
    } catch (cause) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw cause;
    }
  }

  async writeArtifact(name: string, contents: string): Promise<string> {
    await this.ensure();
    const path = join(this.dir, name);
    await writeFile(path, contents, "utf8");
    return path;
  }
}
