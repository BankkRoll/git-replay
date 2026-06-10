#!/usr/bin/env node
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import pc from "picocolors";
import { parseArgs, flagString, flagBool, flagNumber } from "./args.js";
import { init } from "./init.js";
import { loadConfig } from "../lib/config.js";
import { openRun } from "../lib/context.js";
import { runPipeline } from "../stages/pipeline.js";
import { reconstruct } from "../stages/reconstruct.js";
import { bisect } from "../stages/bisect.js";
import { localize } from "../stages/localize.js";
import { fix } from "../stages/fix.js";
import { logger } from "../lib/logger.js";
import { isReplayError } from "../lib/errors.js";

const USAGE = `replay — prove the bug, prove the fix

Usage:
  replay init [--test "<cmd>"] [--force]
  replay run "<bug report | issue text | path to file>" [options]
  replay reconstruct "<bug>" [options]
  replay bisect "<bug>" [options]
  replay localize "<bug>" [options]
  replay fix "<bug>" [options]

Options:
  --root <dir>       repository root (default: cwd)
  --candidates <n>   number of candidate fixes to try
  --concurrency <n>  max candidates verified at once
  --good <ref>       known-good commit to bound bisect
  --bad <ref>        known-bad commit (default: HEAD)
  --test "<cmd>"     full test-suite command (init only)
  --setup "<cmd>"    setup command run before tests, e.g. "npm ci" (init only)
  --force            overwrite existing config (init only)
  --verbose          debug logging
  --quiet            errors only
  -h, --help         show this help
  -v, --version      print version
`;

const STAGE_COMMANDS = new Set(["reconstruct", "bisect", "localize", "fix"]);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.has("version") || args.flags.has("v") || args.command === "version") {
    process.stdout.write(`${await readVersion()}\n`);
    return 0;
  }

  if (args.flags.has("help") || args.flags.has("h") || args.command === undefined) {
    process.stdout.write(USAGE);
    return args.command === undefined ? 1 : 0;
  }

  if (flagBool(args, "verbose")) logger.setLevel("debug");
  else if (flagBool(args, "quiet")) logger.setLevel("error");

  const root = resolve(flagString(args, "root") ?? process.cwd());

  if (args.command === "init") {
    await init({
      root,
      testCommand: flagString(args, "test") ?? "npm test",
      setupCommand: flagString(args, "setup"),
      force: flagBool(args, "force"),
    });
    return 0;
  }

  if (args.command === "run" || STAGE_COMMANDS.has(args.command)) {
    const bug = await resolveBug(args.positionals[0]);
    const loaded = await loadConfig(root);
    applyOverrides(loaded, args);
    const ctx = await openRun(loaded, bug);

    if (args.command === "run") {
      const result = await runPipeline(ctx);
      logger.info("");
      logger.success("done — every artifact below is machine-verified");
      logger.info(`  ${pc.bold("repro.test")}  ${result.reproTestPath}`);
      logger.info(`  ${pc.bold("fix.patch")}   ${result.patchPath}`);
      logger.info(`  ${pc.bold("bisect.log")}  ${result.bisectLogPath}`);
      logger.info(`  ${pc.bold("root-cause")}  ${result.rootCausePath}`);
      return 0;
    }

    const { assertGitRepo } = await import("../lib/git.js");
    await assertGitRepo(root);
    const repro = await reconstruct(ctx);
    if (args.command === "reconstruct") return stageStop(ctx);
    const bisectResult = await bisect(ctx, repro);
    if (args.command === "bisect") return stageStop(ctx);
    const localized = await localize(ctx, repro, bisectResult);
    if (args.command === "localize") return stageStop(ctx);
    await fix(ctx, repro, bisectResult, localized);
    return stageStop(ctx);
  }

  logger.error(`unknown command "${args.command}"`);
  process.stdout.write(USAGE);
  return 1;
}

function applyOverrides(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
  args: ParsedArgs,
): void {
  const candidates = flagNumber(args, "candidates");
  if (candidates !== undefined) loaded.config.fix.candidates = candidates;
  const concurrency = flagNumber(args, "concurrency");
  if (concurrency !== undefined) loaded.config.fix.concurrency = concurrency;
  const good = flagString(args, "good");
  if (good !== undefined) loaded.config.bisect.good = good;
  const bad = flagString(args, "bad");
  if (bad !== undefined) loaded.config.bisect.bad = bad;
}

function stageStop(ctx: Awaited<ReturnType<typeof openRun>>): number {
  logger.info(`stage artifacts written to ${ctx.store.runDir}`);
  logger.hint('run "replay run <bug>" to produce the full replay-out/ bundle');
  return 0;
}

async function readVersion(): Promise<string> {
  const { fileURLToPath } = await import("node:url");
  const here = fileURLToPath(new URL(".", import.meta.url));
  const pkgPath = resolve(here, "..", "..", "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function resolveBug(input: string | undefined): Promise<string> {
  if (!input) {
    throw new Error('provide a bug report: replay run "uploading a 0-byte file 500s the server"');
  }
  const looksLikePath = /[\\/]/.test(input) || /\.(md|txt|log)$/.test(input);
  if (looksLikePath) {
    try {
      return await readFile(resolve(input), "utf8");
    } catch {
      return input;
    }
  }
  return input;
}

type ParsedArgs = ReturnType<typeof parseArgs>;

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (isReplayError(error)) {
      logger.error(error.message);
      if (error.hint) logger.hint(error.hint);
      process.exit(error.code === "QUOTA" ? 2 : 1);
    }
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
