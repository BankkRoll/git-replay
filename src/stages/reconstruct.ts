import { join, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { StageContext } from "../lib/context.js";
import type { ReproArtifact } from "../lib/checkpoint.js";
import { agentJson } from "../lib/agent.js";
import { addWorktree } from "../lib/git.js";
import { runCommand } from "../lib/exec.js";
import { applyCredential } from "../lib/auth.js";
import { GateError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const ReproPlan = z.object({
  testPath: z.string().min(1),
  testSource: z.string().min(1),
  command: z.string().min(1),
});

const SYSTEM = `You reconstruct software bugs as a single failing automated test.
You are given a bug report and project context. Produce one self-contained test file
that exercises the described failure. The test MUST fail against the current code —
that failure is the proof the bug is real. Do not fix the bug. Do not write a test
that passes. Use the project's existing test framework and conventions.

Respond with a single JSON object and nothing else:
{
  "testPath": "<repo-relative path for the new test file>",
  "testSource": "<complete source of the test file>",
  "command": "<shell command that runs ONLY this test and exits non-zero on failure>"
}`;

export async function reconstruct(ctx: StageContext): Promise<ReproArtifact> {
  if (ctx.state.reconstruct) {
    logger.step("reconstruct", "using checkpointed repro");
    return ctx.state.reconstruct;
  }

  logger.step("reconstruct", "asking agent for a failing repro test");
  const plan = await agentJson(
    ctx.agent,
    {
      model: ctx.loaded.config.models.reconstruct,
      system: SYSTEM,
      prompt: buildPrompt(ctx),
      maxTokens: 8_000,
      thinkingTokens: ctx.loaded.config.maxThinkingTokens,
    },
    ReproPlan,
  );

  const env = applyCredential(ctx.credential, process.env);
  logger.step("reconstruct", `running repro: ${plan.command}`);
  const worktree = await addWorktree(ctx.loaded.root, "HEAD");
  let outcome;
  try {
    const absTestPath = join(worktree.path, plan.testPath);
    await mkdir(dirname(absTestPath), { recursive: true });
    await writeFile(absTestPath, plan.testSource, "utf8");
    if (ctx.loaded.config.setupCommand) {
      const setup = await runCommand(ctx.loaded.config.setupCommand, {
        cwd: worktree.path,
        timeoutMs: ctx.loaded.config.suiteTimeoutMs,
        env,
      });
      if (!setup.passed) {
        throw new GateError(
          "setup",
          `setup command failed before the repro could run:\n${setup.output}`,
          "fix setupCommand in replay.config.json so the project builds, then re-run",
        );
      }
    }
    outcome = await runCommand(plan.command, {
      cwd: worktree.path,
      timeoutMs: ctx.loaded.config.reproTimeoutMs,
      env,
    });
  } finally {
    await worktree.remove();
  }

  if (outcome.passed) {
    throw new GateError(
      "repro",
      "the generated test passed on current code — could not reproduce the bug",
      "the report may lack detail, or the bug is environment-specific; refine the bug description and re-run",
    );
  }

  const artifact: ReproArtifact = {
    testPath: plan.testPath,
    testSource: plan.testSource,
    command: plan.command,
    failingOutput: outcome.output,
  };

  ctx.state.reconstruct = artifact;
  await ctx.store.save(ctx.state);
  await ctx.store.writeArtifact("repro.test.txt", plan.testSource);
  logger.success(`repro is red — bug confirmed (exit ${outcome.exitCode})`);
  return artifact;
}

function buildPrompt(ctx: StageContext): string {
  const sections = [
    `Bug report:\n${ctx.state.bug}`,
    `Test command convention: ${ctx.loaded.config.testCommand}`,
  ];
  if (ctx.loaded.info.trim()) {
    sections.push(`Project context (INFO.md):\n${ctx.loaded.info.trim()}`);
  }
  return sections.join("\n\n");
}
