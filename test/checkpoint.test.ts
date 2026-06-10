import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore, runId, type RunState } from "../src/lib/checkpoint.js";

function baseState(): RunState {
  return {
    id: "abc123",
    bug: "thing breaks",
    createdAt: "2026-01-01T00:00:00.000Z",
    backend: "claude",
  };
}

async function withData<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "replay-ckpt-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("checkpoint", () => {
  it("derives a stable id from bug + timestamp", () => {
    const a = runId("bug", "2026-01-01T00:00:00.000Z");
    const b = runId("bug", "2026-01-01T00:00:00.000Z");
    const c = runId("bug", "2026-01-02T00:00:00.000Z");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(12);
  });

  it("persists and reloads state", async () => {
    await withData(async (dataDir) => {
      const store = new CheckpointStore(dataDir, "abc123");
      expect(store.exists()).toBe(false);
      const state = baseState();
      await store.save(state);
      expect(store.exists()).toBe(true);
      const loaded = await store.load();
      expect(loaded).toEqual(state);
    });
  });

  it("round-trips a completed stage artifact", async () => {
    await withData(async (dataDir) => {
      const store = new CheckpointStore(dataDir, "abc123");
      const state = baseState();
      state.reconstruct = {
        testPath: "test/repro.test.ts",
        testSource: "expect(1).toBe(2)",
        command: "vitest run repro",
        failingOutput: "AssertionError",
      };
      await store.save(state);
      const loaded = await store.load();
      expect(loaded.reconstruct?.command).toBe("vitest run repro");
    });
  });

  it("writes artifacts into the run directory", async () => {
    await withData(async (dataDir) => {
      const store = new CheckpointStore(dataDir, "abc123");
      const path = await store.writeArtifact("fix.patch", "diff --git");
      expect(await readFile(path, "utf8")).toBe("diff --git");
    });
  });
});
