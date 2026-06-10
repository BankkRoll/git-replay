import { z } from "zod";
import type { StageContext } from "../lib/context.js";
import type { BisectArtifact, LocalizeArtifact, ReproArtifact } from "../lib/checkpoint.js";
import { agentJson } from "../lib/agent.js";
import { diffOf } from "../lib/git.js";
import { logger } from "../lib/logger.js";

const LocalizeResult = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  rootCause: z.string().min(1),
  evidence: z.string().min(1),
});

const SYSTEM = `You localize the root cause of a software bug to a single file and line.
You are given: the bug report, the failing test output, and the exact commit diff that
introduced the bug (found by git bisect). The root cause is almost always inside that diff.
Identify the precise file and line where the defect lives, explain the mechanism, and cite
the specific lines of the introducing diff as evidence.

Respond with a single JSON object and nothing else:
{
  "file": "<repo-relative path>",
  "line": <1-based line number>,
  "rootCause": "<why the code is wrong and how it produces the failure>",
  "evidence": "<the lines of the introducing diff that prove it>"
}`;

export async function localize(
  ctx: StageContext,
  repro: ReproArtifact,
  bisectResult: BisectArtifact,
): Promise<LocalizeArtifact> {
  if (ctx.state.localize) {
    logger.step("localize", "using checkpointed result");
    return ctx.state.localize;
  }

  logger.step("localize", `pinning root cause within ${bisectResult.introducedAt.slice(0, 7)}`);
  const diff = await diffOf(ctx.loaded.root, bisectResult.introducedAt);

  const result = await agentJson(
    ctx.agent,
    {
      model: ctx.loaded.config.models.localize,
      system: SYSTEM,
      prompt: buildPrompt(ctx, repro, bisectResult, diff),
      maxTokens: 4_000,
      thinkingTokens: ctx.loaded.config.maxThinkingTokens,
    },
    LocalizeResult,
  );

  ctx.state.localize = result;
  await ctx.store.save(ctx.state);
  await ctx.store.writeArtifact(
    "root-cause.md",
    renderRootCause(result, bisectResult),
  );
  logger.success(`root cause: ${result.file}:${result.line}`);
  return result;
}

function buildPrompt(
  ctx: StageContext,
  repro: ReproArtifact,
  bisectResult: BisectArtifact,
  diff: string,
): string {
  const sections = [
    `Bug report:\n${ctx.state.bug}`,
    `Failing test output:\n${repro.failingOutput}`,
    `Introducing commit ${bisectResult.introducedAt} — "${bisectResult.subject}":\n${diff}`,
  ];
  if (ctx.loaded.info.trim()) {
    sections.push(`Project context (INFO.md):\n${ctx.loaded.info.trim()}`);
  }
  return sections.join("\n\n");
}

function renderRootCause(result: LocalizeArtifact, bisectResult: BisectArtifact): string {
  return [
    `# Root cause`,
    ``,
    `**Location:** \`${result.file}:${result.line}\``,
    `**Introduced at:** \`${bisectResult.introducedAt}\` by ${bisectResult.author} (${bisectResult.date})`,
    `**Commit:** ${bisectResult.subject}`,
    ``,
    `## Why it fails`,
    ``,
    result.rootCause,
    ``,
    `## Evidence`,
    ``,
    "```diff",
    result.evidence,
    "```",
    "",
  ].join("\n");
}
