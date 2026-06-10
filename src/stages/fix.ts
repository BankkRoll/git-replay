import { join, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { StageContext } from "../lib/context.js";
import type {
  BisectArtifact,
  FixArtifact,
  LocalizeArtifact,
  ReproArtifact,
} from "../lib/checkpoint.js";
import { addWorktree, applyPatch, diffExcluding } from "../lib/git.js";
import { runCommand } from "../lib/exec.js";
import { applyCredential } from "../lib/auth.js";
import { agentJson } from "../lib/agent.js";
import { mapPool, values } from "../lib/pool.js";
import { GateError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const FixPlan = z.object({
  patch: z.string().min(1),
  rationale: z.string().min(1),
});

const SYSTEM = `You fix a software bug with the smallest correct change.
You are given the bug report, the root cause (file and line), the introducing diff, and
the failing test. Produce a minimal patch in unified diff format (as accepted by
"git apply --3way") that fixes the root cause. Do not modify the repro test. Do not
reformat unrelated code. Keep the change as small as the fix requires.

Respond with a single JSON object and nothing else:
{
  "patch": "<unified diff, starting with 'diff --git' or '--- a/...'>",
  "rationale": "<one paragraph: what you changed and why it fixes the root cause>"
}`;

interface CandidateOutcome {
  index: number;
  patch: string;
  reproPassed: boolean;
  suitePassed: boolean;
  detail: string;
}

export async function fix(
  ctx: StageContext,
  repro: ReproArtifact,
  bisectResult: BisectArtifact,
  localized: LocalizeArtifact,
): Promise<FixArtifact> {
  if (ctx.state.fix?.suitePassed) {
    logger.step("fix", "using checkpointed verified fix");
    return ctx.state.fix;
  }

  const count = ctx.loaded.config.fix.candidates;
  const concurrency = ctx.loaded.config.fix.concurrency;
  logger.step("fix", `generating ${count} candidate patch${count === 1 ? "" : "es"}`);

  const indices = Array.from({ length: count }, (_, index) => index);
  const proposed = await mapPool(indices, concurrency, (index) =>
    proposePatch(ctx, repro, localized, bisectResult, index),
  );
  for (const settled of proposed) {
    if (!settled.ok) logger.warn(`candidate generation failed: ${settled.error.message}`);
  }
  const plans = values(proposed);
  if (plans.length === 0) {
    throw new GateError(
      "fix",
      "every candidate generation failed",
      "the model may be refusing or rate limited — re-run to resume, or refine the bug description",
    );
  }

  logger.step("fix", `verifying ${plans.length} candidate(s) in isolated worktrees`);
  const verified = await mapPool(plans, concurrency, (plan, index) =>
    verifyCandidate(ctx, repro, plan.patch, index),
  );
  const outcomes: CandidateOutcome[] = [];
  for (const settled of verified) {
    if (settled.ok) outcomes.push(settled.value);
    else logger.warn(`candidate verification failed: ${settled.error.message}`);
  }

  const winner = outcomes.find((o) => o.reproPassed && o.suitePassed);
  if (!winner) {
    const summary = outcomes
      .map((o) => `  candidate ${o.index}: repro ${gate(o.reproPassed)}, suite ${gate(o.suitePassed)} — ${o.detail}`)
      .join("\n");
    throw new GateError(
      "fix",
      `no candidate passed both gates\n${summary || "  (all candidates errored)"}`,
      "increase fix.candidates, refine INFO.md, or inspect root-cause.md and patch manually",
    );
  }

  const artifact: FixArtifact = {
    patch: winner.patch,
    reproPassed: true,
    suitePassed: true,
    candidateIndex: winner.index,
  };
  ctx.state.fix = artifact;
  await ctx.store.save(ctx.state);
  await ctx.store.writeArtifact("fix.patch", winner.patch);
  logger.success(`candidate ${winner.index} passed both gates — fix verified`);
  return artifact;
}

async function proposePatch(
  ctx: StageContext,
  repro: ReproArtifact,
  localized: LocalizeArtifact,
  bisectResult: BisectArtifact,
  index: number,
): Promise<z.infer<typeof FixPlan>> {
  const prompt = [
    `Bug report:\n${ctx.state.bug}`,
    `Root cause at ${localized.file}:${localized.line}:\n${localized.rootCause}`,
    `Evidence:\n${localized.evidence}`,
    `Failing test output:\n${repro.failingOutput}`,
    `Introducing commit: ${bisectResult.subject} (${bisectResult.introducedAt})`,
    index === 0
      ? `Produce the most direct minimal fix.`
      : `Produce an alternative fix that differs in approach from a direct one-line change (variant ${index}).`,
  ].join("\n\n");

  return agentJson(
    ctx.agent,
    {
      model: ctx.loaded.config.models.fix,
      system: SYSTEM,
      prompt,
      maxTokens: 4_000,
      thinkingTokens: ctx.loaded.config.maxThinkingTokens,
    },
    FixPlan,
  );
}

async function verifyCandidate(
  ctx: StageContext,
  repro: ReproArtifact,
  patch: string,
  index: number,
): Promise<CandidateOutcome> {
  const env = applyCredential(ctx.credential, process.env);
  const worktree = await addWorktree(ctx.loaded.root, "HEAD");
  try {
    const applied = await applyPatch(worktree.path, patch);
    if (!applied) {
      return { index, patch, reproPassed: false, suitePassed: false, detail: "patch did not apply" };
    }

    const reconciled = await diffExcluding(worktree.path, [repro.testPath]);
    const finalPatch = reconciled.trim() ? reconciled : patch;

    const reproAbs = join(worktree.path, repro.testPath);
    await mkdir(dirname(reproAbs), { recursive: true });
    await writeFile(reproAbs, repro.testSource, "utf8");

    if (ctx.loaded.config.setupCommand) {
      const setup = await runCommand(ctx.loaded.config.setupCommand, {
        cwd: worktree.path,
        timeoutMs: ctx.loaded.config.suiteTimeoutMs,
        env,
      });
      if (!setup.passed) {
        return { index, patch: finalPatch, reproPassed: false, suitePassed: false, detail: "setup command failed" };
      }
    }

    const reproRun = await runCommand(repro.command, {
      cwd: worktree.path,
      timeoutMs: ctx.loaded.config.reproTimeoutMs,
      env,
    });
    if (!reproRun.passed) {
      return {
        index,
        patch: finalPatch,
        reproPassed: false,
        suitePassed: false,
        detail: reproRun.timedOut ? "repro timed out" : `repro still red (exit ${reproRun.exitCode})`,
      };
    }

    const suiteRun = await runCommand(ctx.loaded.config.testCommand, {
      cwd: worktree.path,
      timeoutMs: ctx.loaded.config.suiteTimeoutMs,
      env,
    });

    return {
      index,
      patch: finalPatch,
      reproPassed: true,
      suitePassed: suiteRun.passed,
      detail: suiteRun.passed
        ? "both gates green"
        : suiteRun.timedOut
          ? "suite timed out"
          : `suite regressed (exit ${suiteRun.exitCode})`,
    };
  } finally {
    await worktree.remove();
  }
}

function gate(passed: boolean): string {
  return passed ? "green" : "red";
}
