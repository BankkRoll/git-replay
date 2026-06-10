import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertGitRepo,
  isClean,
  firstCommit,
  countCommits,
  currentRef,
  addWorktree,
  applyPatch,
  diffExcluding,
  bisectStart,
  bisectMark,
  bisectReset,
  resolveRef,
  isShallow,
} from "../src/lib/git.js";

let root = "";

async function run(args: string[]): Promise<void> {
  await execa("git", args, { cwd: root });
}

async function commit(file: string, body: string, message: string): Promise<void> {
  await writeFile(join(root, file), body, "utf8");
  await run(["add", "-A"]);
  await run(["commit", "-q", "-m", message]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "replay-git-"));
  await run(["init", "-q"]);
  await run(["config", "user.email", "t@t.t"]);
  await run(["config", "user.name", "t"]);
  await run(["config", "commit.gpgsign", "false"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("git helpers", () => {
  it("recognizes a repo and a clean tree", async () => {
    await commit("a.txt", "1", "first");
    await expect(assertGitRepo(root)).resolves.toBeUndefined();
    expect(await isClean(root)).toBe(true);
  });

  it("detects a dirty tree", async () => {
    await commit("a.txt", "1", "first");
    await writeFile(join(root, "a.txt"), "2", "utf8");
    expect(await isClean(root)).toBe(false);
  });

  it("counts commits in a range", async () => {
    await commit("a.txt", "1", "c1");
    const base = await firstCommit(root);
    await commit("a.txt", "2", "c2");
    await commit("a.txt", "3", "c3");
    expect(await countCommits(root, base, await currentRef(root))).toBe(2);
  });

  it("creates an isolated worktree and applies a patch without touching the main tree", async () => {
    await commit("a.txt", "hello\n", "first");
    const wt = await addWorktree(root, "HEAD");
    try {
      const patch = [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1 +1 @@",
        "-hello",
        "+goodbye",
        "",
      ].join("\n");
      expect(await applyPatch(wt.path, patch)).toBe(true);
      expect(await isClean(wt.path)).toBe(false);
      expect(await isClean(root)).toBe(true);
    } finally {
      await wt.remove();
    }
  });

  it("reports a normal clone as not shallow", async () => {
    await commit("a.txt", "1", "first");
    expect(await isShallow(root)).toBe(false);
  });

  it("rejects a non-repo directory", async () => {
    const plain = await mkdtemp(join(tmpdir(), "replay-plain-"));
    try {
      await expect(assertGitRepo(plain)).rejects.toThrow(/not a git repository/);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("excludes the repro path and includes new files in the captured patch", async () => {
    await commit("src.txt", "v1\n", "first");
    await writeFile(join(root, "src.txt"), "v2\n", "utf8");
    await writeFile(join(root, "new.txt"), "created\n", "utf8");
    await writeFile(join(root, "repro.test.txt"), "ignore me\n", "utf8");
    const patch = await diffExcluding(root, ["repro.test.txt"]);
    expect(patch).toContain("src.txt");
    expect(patch).toContain("new.txt");
    expect(patch).not.toContain("repro.test.txt");
  });

  it("finds the introducing commit via bisect in a worktree", async () => {
    await commit("app.txt", "clean\n", "c1: ok");
    await commit("app.txt", "clean\n\nmore\n", "c2: ok");
    await commit("app.txt", "BUG\n", "c3: introduce bug");
    const culpritExpected = await currentRef(root);
    await commit("app.txt", "BUG\nstill\n", "c4: ok");
    await commit("app.txt", "BUG\nstill\nmore\n", "c5: ok");

    const good = await firstCommit(root);
    const bad = await resolveRef(root, "HEAD");
    const wt = await addWorktree(root, bad);
    try {
      await bisectStart(wt.path, good, bad);
      let found = "";
      for (let i = 0; i < 10; i += 1) {
        const content = await readFile(join(wt.path, "app.txt"), "utf8").catch(() => "");
        const verdict = content.includes("BUG") ? "bad" : "good";
        const out = await bisectMark(wt.path, verdict);
        const match = out.match(/(\b[0-9a-f]{7,40}\b) is the first bad commit/i);
        if (match?.[1]) {
          found = await resolveRef(wt.path, match[1]);
          break;
        }
      }
      expect(found).toBe(culpritExpected);
    } finally {
      await bisectReset(wt.path);
      await wt.remove();
    }
  });
});
