import { execa } from "execa";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitError } from "./errors.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function git(root: string, args: string[]): Promise<CommandResult> {
  const result = await execa("git", args, {
    cwd: root,
    reject: false,
    all: false,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export async function assertGitRepo(root: string): Promise<void> {
  const res = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (res.exitCode !== 0 || res.stdout.trim() !== "true") {
    throw new GitError(`${root} is not a git repository`, 'run "git init" or point replay at a repo');
  }
}

export async function isClean(root: string): Promise<boolean> {
  const res = await git(root, ["status", "--porcelain"]);
  return res.exitCode === 0 && res.stdout.trim() === "";
}

export async function currentRef(root: string): Promise<string> {
  const res = await git(root, ["rev-parse", "HEAD"]);
  if (res.exitCode !== 0) throw new GitError("could not read HEAD", res.stderr.trim());
  return res.stdout.trim();
}

export async function isShallow(root: string): Promise<boolean> {
  const res = await git(root, ["rev-parse", "--is-shallow-repository"]);
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

export async function resolveRef(root: string, ref: string): Promise<string> {
  const res = await git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (res.exitCode !== 0) throw new GitError(`cannot resolve ref "${ref}"`, res.stderr.trim());
  return res.stdout.trim();
}

export async function firstCommit(root: string): Promise<string> {
  const res = await git(root, ["rev-list", "--max-parents=0", "HEAD"]);
  if (res.exitCode !== 0) throw new GitError("could not find root commit", res.stderr.trim());
  const lines = res.stdout.trim().split("\n").filter(Boolean);
  const last = lines.at(-1);
  if (!last) throw new GitError("repository has no commits");
  return last;
}

export async function countCommits(root: string, good: string, bad: string): Promise<number> {
  const res = await git(root, ["rev-list", "--count", `${good}..${bad}`]);
  if (res.exitCode !== 0) throw new GitError("could not count commits", res.stderr.trim());
  return Number.parseInt(res.stdout.trim(), 10) || 0;
}

export interface CommitMeta {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export async function commitMeta(root: string, ref: string): Promise<CommitMeta> {
  const res = await git(root, ["show", "-s", "--format=%H%n%an <%ae>%n%aI%n%s", ref]);
  if (res.exitCode !== 0) throw new GitError(`could not read commit ${ref}`, res.stderr.trim());
  const [hash, author, date, subject] = res.stdout.trim().split("\n");
  return {
    hash: hash ?? ref,
    author: author ?? "unknown",
    date: date ?? "",
    subject: subject ?? "",
  };
}

export async function diffOf(root: string, ref: string): Promise<string> {
  const res = await git(root, ["show", "--no-color", ref]);
  if (res.exitCode !== 0) throw new GitError(`could not diff ${ref}`, res.stderr.trim());
  return res.stdout;
}

export async function bisectStart(root: string, good: string, bad: string): Promise<void> {
  await git(root, ["bisect", "reset"]);
  const start = await git(root, ["bisect", "start", bad, good]);
  if (start.exitCode !== 0) throw new GitError("git bisect start failed", start.stderr.trim());
}

export async function bisectMark(root: string, verdict: "good" | "bad"): Promise<string> {
  const res = await git(root, ["bisect", verdict]);
  if (res.exitCode !== 0) throw new GitError(`git bisect ${verdict} failed`, res.stderr.trim());
  return res.stdout;
}

export async function bisectReset(root: string): Promise<void> {
  await git(root, ["bisect", "reset"]);
}

export async function bisectLog(root: string): Promise<string> {
  const res = await git(root, ["bisect", "log"]);
  return res.exitCode === 0 ? res.stdout : "";
}

export interface Worktree {
  path: string;
  remove: () => Promise<void>;
}

export async function addWorktree(root: string, ref: string): Promise<Worktree> {
  const base = await mkdtemp(join(tmpdir(), "replay-wt-"));
  const res = await git(root, ["worktree", "add", "--quiet", "--detach", base, ref]);
  if (res.exitCode !== 0) {
    await rm(base, { recursive: true, force: true });
    throw new GitError(`could not create worktree for ${ref}`, res.stderr.trim());
  }
  return {
    path: base,
    remove: async () => {
      try {
        await git(root, ["worktree", "remove", "--force", base]);
      } catch {
        // fall through to filesystem removal
      }
      await rm(base, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export async function resetWorktree(root: string): Promise<void> {
  await git(root, ["reset", "--quiet", "--hard", "HEAD"]);
  await git(root, ["clean", "-qfd"]);
}

export async function applyPatch(root: string, patch: string): Promise<boolean> {
  const body = patch.endsWith("\n") ? patch : `${patch}\n`;
  const attempts = [["apply", "--3way"], ["apply"]];
  for (let i = 0; i < attempts.length; i += 1) {
    const res = await execa("git", [...attempts[i]!, "-"], { cwd: root, input: body, reject: false });
    if ((res.exitCode ?? 1) === 0) return true;
    await resetWorktree(root);
  }
  return false;
}

export async function diffExcluding(root: string, excludePaths: string[]): Promise<string> {
  await git(root, ["add", "-A"]);
  const args = ["diff", "--no-color", "--cached"];
  if (excludePaths.length) {
    args.push("--", ".", ...excludePaths.map((p) => `:(exclude)${p}`));
  }
  const res = await git(root, args);
  return res.stdout;
}
