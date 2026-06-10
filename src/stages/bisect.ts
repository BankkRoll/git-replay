import { join, dirname } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import type { StageContext } from "../lib/context.js";
import type { BisectArtifact, ReproArtifact } from "../lib/checkpoint.js";
import {
  addWorktree,
  bisectStart,
  bisectMark,
  bisectReset,
  bisectLog,
  commitMeta,
  countCommits,
  currentRef,
  firstCommit,
  isShallow,
  resetWorktree,
  resolveRef,
} from "../lib/git.js";
import { runCommand } from "../lib/exec.js";
import { applyCredential } from "../lib/auth.js";
import { GitError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const BISECT_DONE = /(\b[0-9a-f]{7,40}\b) is the first bad commit/i;

export async function bisect(ctx: StageContext, repro: ReproArtifact): Promise<BisectArtifact> {
  if (ctx.state.bisect) {
    logger.step("bisect", "using checkpointed result");
    return ctx.state.bisect;
  }

  const cfg = ctx.loaded.config.bisect;
  if (!cfg.good && (await isShallow(ctx.loaded.root))) {
    throw new GitError(
      "cannot bisect a shallow clone without a known-good commit",
      'run "git fetch --unshallow" (or set bisect.good to a commit that predates the bug)',
    );
  }

  const bad = await resolveRef(ctx.loaded.root, cfg.bad);
  const good = cfg.good
    ? await resolveRef(ctx.loaded.root, cfg.good)
    : await firstCommit(ctx.loaded.root);

  if (good === bad) {
    throw new GitError(
      "bisect good and bad refs are identical",
      "set bisect.good to a commit known to predate the bug",
    );
  }

  const span = await countCommits(ctx.loaded.root, good, bad);
  if (span > cfg.maxCommits) {
    throw new GitError(
      `range ${good.slice(0, 7)}..${bad.slice(0, 7)} spans ${span} commits (max ${cfg.maxCommits})`,
      "narrow it by setting bisect.good in replay.config.json",
    );
  }

  const env = applyCredential(ctx.credential, process.env);
  logger.step("bisect", `searching ${span} commits between ${good.slice(0, 7)} and ${bad.slice(0, 7)}`);

  const worktree = await addWorktree(ctx.loaded.root, bad);
  const maxProbes = span + 2;
  try {
    await bisectStart(worktree.path, good, bad);
    for (let probes = 1; probes <= maxProbes; probes += 1) {
      const head = await currentRef(worktree.path);
      await placeRepro(worktree.path, repro);
      const outcome = await runCommand(repro.command, {
        cwd: worktree.path,
        timeoutMs: ctx.loaded.config.reproTimeoutMs,
        env,
      });
      const verdict = outcome.passed ? "good" : "bad";
      logger.debug(`probe ${probes}: ${head.slice(0, 7)} → ${verdict}`);
      await removeRepro(worktree.path, repro);
      await resetWorktree(worktree.path);
      const out = await bisectMark(worktree.path, verdict);
      const match = out.match(BISECT_DONE);
      if (match?.[1]) {
        return await finalize(ctx, worktree.path, match[1]);
      }
    }
    throw new GitError(
      `bisect did not converge within ${maxProbes} probes`,
      "the repro may be flaky or the history may contain skipped/merge commits — narrow bisect.good",
    );
  } finally {
    await bisectReset(worktree.path);
    await worktree.remove();
  }
}

async function finalize(
  ctx: StageContext,
  cwd: string,
  ref: string,
): Promise<BisectArtifact> {
  const culprit = await resolveRef(cwd, ref);
  const meta = await commitMeta(cwd, culprit);
  const log = await bisectLog(cwd);
  const artifact: BisectArtifact = {
    introducedAt: meta.hash,
    author: meta.author,
    date: meta.date,
    subject: meta.subject,
    log,
  };
  ctx.state.bisect = artifact;
  await ctx.store.save(ctx.state);
  await ctx.store.writeArtifact("bisect.log", log);
  logger.success(`introduced at ${meta.hash.slice(0, 7)} by ${meta.author} — "${meta.subject}"`);
  return artifact;
}

async function placeRepro(root: string, repro: ReproArtifact): Promise<void> {
  const abs = join(root, repro.testPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, repro.testSource, "utf8");
}

async function removeRepro(root: string, repro: ReproArtifact): Promise<void> {
  await rm(join(root, repro.testPath), { force: true }).catch(() => undefined);
}
