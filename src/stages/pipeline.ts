import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { StageContext } from "../lib/context.js";
import { reconstruct } from "./reconstruct.js";
import { bisect } from "./bisect.js";
import { localize } from "./localize.js";
import { fix } from "./fix.js";
import { assertGitRepo } from "../lib/git.js";
import { logger } from "../lib/logger.js";

export interface PipelineResult {
  outDir: string;
  reproTestPath: string;
  patchPath: string;
  bisectLogPath: string;
  rootCausePath: string;
}

export async function runPipeline(ctx: StageContext): Promise<PipelineResult> {
  await assertGitRepo(ctx.loaded.root);

  const repro = await reconstruct(ctx);
  const bisectResult = await bisect(ctx, repro);
  const localized = await localize(ctx, repro, bisectResult);
  const verified = await fix(ctx, repro, bisectResult, localized);

  const outDir = join(ctx.loaded.root, "replay-out");
  const reproTestPath = join(outDir, "repro.test.txt");
  const patchPath = join(outDir, "fix.patch");
  const bisectLogPath = join(outDir, "bisect.log");
  const rootCausePath = join(outDir, "root-cause.md");

  await writeBundle(outDir, {
    reproTestPath,
    patchPath,
    bisectLogPath,
    rootCausePath,
    reproSource: repro.testSource,
    patch: verified.patch,
    bisectLog: bisectResult.log,
    rootCause: renderRootCause(ctx, bisectResult, localized),
  });

  logger.success(`artifacts written to ${outDir}`);
  return { outDir, reproTestPath, patchPath, bisectLogPath, rootCausePath };
}

interface BundleInput {
  reproTestPath: string;
  patchPath: string;
  bisectLogPath: string;
  rootCausePath: string;
  reproSource: string;
  patch: string;
  bisectLog: string;
  rootCause: string;
}

async function writeBundle(outDir: string, input: BundleInput): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(input.reproTestPath, input.reproSource, "utf8"),
    writeFile(input.patchPath, input.patch.endsWith("\n") ? input.patch : `${input.patch}\n`, "utf8"),
    writeFile(input.bisectLogPath, input.bisectLog, "utf8"),
    writeFile(input.rootCausePath, input.rootCause, "utf8"),
  ]);
}

function renderRootCause(
  ctx: StageContext,
  bisectResult: NonNullable<StageContext["state"]["bisect"]>,
  localized: NonNullable<StageContext["state"]["localize"]>,
): string {
  return [
    `# Root cause`,
    ``,
    `**Bug:** ${ctx.state.bug}`,
    `**Location:** \`${localized.file}:${localized.line}\``,
    `**Introduced at:** \`${bisectResult.introducedAt}\` by ${bisectResult.author} (${bisectResult.date})`,
    `**Commit:** ${bisectResult.subject}`,
    ``,
    `## Why it fails`,
    ``,
    localized.rootCause,
    ``,
    `## Evidence`,
    ``,
    "```diff",
    localized.evidence,
    "```",
    "",
  ].join("\n");
}
