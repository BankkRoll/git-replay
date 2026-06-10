import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { DOT_DIR, CONFIG_FILE, INFO_FILE, defaultConfig } from "../lib/config.js";
import { assertGitRepo } from "../lib/git.js";
import { logger } from "../lib/logger.js";

export interface InitOptions {
  root: string;
  testCommand: string;
  setupCommand: string | undefined;
  force: boolean;
}

const ENV_TEMPLATE = `# replay reads credentials in this precedence order:
#   1. explicit provider keys (highest priority)
#        ANTHROPIC_AUTH_TOKEN=sk-ant-...
#        ANTHROPIC_BASE_URL=https://api.anthropic.com
#        OPENAI_API_KEY=sk-...
#   2. Vercel AI Gateway (one key covers Claude + Codex)
#        AI_GATEWAY_API_KEY=vck_...
#      or OIDC: run "npx vercel link && npx vercel env pull" to write VERCEL_OIDC_TOKEN
#   3. local subscription session (claude login / codex login) — evaluation only
`;

function infoTemplate(project: string): string {
  return `# ${project}

Project context injected into every replay agent prompt. Vague content here means
vague root-cause analysis — fill it in.

## What this project is

<one paragraph: what the codebase does>

## How to run tests

<the exact command(s); the default is captured in replay.config.json>

## Architecture notes

<modules, entry points, anything an agent needs to reproduce and fix bugs correctly>
`;
}

export async function init(options: InitOptions): Promise<void> {
  await assertGitRepo(options.root);

  const dotDir = join(options.root, DOT_DIR);
  const configPath = join(dotDir, CONFIG_FILE);

  if (existsSync(configPath) && !options.force) {
    logger.warn(`${configPath} already exists — pass --force to overwrite`);
    return;
  }

  await mkdir(join(dotDir, "data"), { recursive: true });

  const project = basename(options.root);
  const config = defaultConfig(options.testCommand);
  if (options.setupCommand) config.setupCommand = options.setupCommand;

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const infoPath = join(dotDir, INFO_FILE);
  if (!existsSync(infoPath) || options.force) {
    await writeFile(infoPath, infoTemplate(project), "utf8");
  }

  const envPath = join(dotDir, ".env.local");
  if (!existsSync(envPath)) {
    await writeFile(envPath, ENV_TEMPLATE, "utf8");
  }

  await ensureGitignore(dotDir);
  await ensureRepoIgnoresOutput(options.root);

  logger.success(`initialized replay project "${project}"`);
  logger.info(`  config:  ${configPath}`);
  logger.info(`  context: ${infoPath}  (fill this in)`);
  logger.info(`  secrets: ${envPath}  (add a credential)`);
  logger.info(`\nnext: replay run "your bug report or issue text"`);
}

async function ensureGitignore(dotDir: string): Promise<void> {
  const path = join(dotDir, ".gitignore");
  const desired = ["data/", ".env.local", ""].join("\n");
  if (!existsSync(path)) {
    await writeFile(path, desired, "utf8");
    return;
  }
  const current = await readFile(path, "utf8");
  const missing = ["data/", ".env.local"].filter((line) => !current.includes(line));
  if (missing.length) {
    await appendFile(path, `${missing.join("\n")}\n`, "utf8");
  }
}

async function ensureRepoIgnoresOutput(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  const entry = "replay-out/";
  if (!existsSync(path)) {
    await writeFile(path, `${entry}\n`, "utf8");
    return;
  }
  const current = await readFile(path, "utf8");
  if (!current.includes(entry)) {
    await appendFile(path, `${current.endsWith("\n") ? "" : "\n"}${entry}\n`, "utf8");
  }
}
