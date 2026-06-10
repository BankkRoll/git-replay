import { describe, it, expect } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, defaultConfig, DOT_DIR, CONFIG_FILE, INFO_FILE } from "../src/lib/config.js";

async function withProject(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "replay-config-"));
  try {
    await mkdir(join(root, DOT_DIR), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      await writeFile(join(root, DOT_DIR, name), body, "utf8");
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("config", () => {
  it("applies defaults to a minimal config", () => {
    const cfg = defaultConfig("pnpm test");
    expect(cfg.defaultAgent).toBe("claude");
    expect(cfg.testCommand).toBe("pnpm test");
    expect(cfg.fix.candidates).toBe(3);
    expect(cfg.bisect.bad).toBe("HEAD");
  });

  it("loads a config and INFO.md from disk", async () => {
    await withProject(
      {
        [CONFIG_FILE]: JSON.stringify({ testCommand: "vitest run" }),
        [INFO_FILE]: "# context\nproject does things",
      },
      async (root) => {
        const loaded = await loadConfig(root);
        expect(loaded.config.testCommand).toBe("vitest run");
        expect(loaded.info).toContain("project does things");
      },
    );
  });

  it("rejects a config missing the required testCommand", async () => {
    await withProject({ [CONFIG_FILE]: "{}" }, async (root) => {
      await expect(loadConfig(root)).rejects.toThrow(/testCommand/);
    });
  });

  it("rejects an unknown/misspelled key", async () => {
    await withProject(
      { [CONFIG_FILE]: JSON.stringify({ testCommand: "t", testCommnad: "typo" }) },
      async (root) => {
        await expect(loadConfig(root)).rejects.toThrow(/invalid/);
      },
    );
  });

  it("rejects invalid JSON with a helpful message", async () => {
    await withProject({ [CONFIG_FILE]: "{ not json" }, async (root) => {
      await expect(loadConfig(root)).rejects.toThrow(/not valid JSON/);
    });
  });

  it("errors when no project is initialized", async () => {
    const root = await mkdtemp(join(tmpdir(), "replay-noinit-"));
    try {
      await expect(loadConfig(root)).rejects.toThrow(/no replay project/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
