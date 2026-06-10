# replay

[![ci](https://github.com/BankkRoll/git-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/BankkRoll/git-replay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/git-replay.svg)](https://www.npmjs.com/package/git-replay)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)

**Hand it a bug, get back a reproducing test, a verified fix, and the commit that introduced it — proven by code that runs, not by prose.**

Most "fix my bug" tools hand you a plausible-looking patch you can't trust. `replay` refuses to emit anything it can't prove. Every artifact it produces is machine-checked: the repro test actually fails on the old code, the fix actually flips it green, and the full suite actually stays green.

```bash
replay run "Issue #482: uploading a 0-byte file 500s the server"
```

```
[reconstruct] running repro: npm test -- upload-empty
✓ repro is red — bug confirmed (exit 1)
[bisect] searching 187 commits between 8c1f0aa and a3f9c2e
✓ introduced at a3f9c2e by Dana Lee — "add size-validation middleware"
[localize] pinning root cause within a3f9c2e
✓ root cause: src/upload.ts:88
[fix] generating 3 candidate patches
[fix] verifying candidates in isolated worktrees
✓ candidate 1 passed both gates — fix verified
✓ artifacts written to replay-out
```

## How it works

A staged, resumable harness. A frontier model orchestrates; every stage is gated and writes a checkpoint, so a run that stops can always resume.

| Stage | Deterministic? | What it does | Gate |
| --- | --- | --- | --- |
| **reconstruct** | AI + run | Reads the bug, writes a minimal failing test, runs it. | The test **must fail**. If it passes, replay stops with "could not reproduce" — it never fabricates a fix for a bug it can't prove is real. |
| **bisect** | fully | Replays the repro across git history (`git bisect`) to find the commit that introduced the bug. | red commits vs green commits — pure mechanics, no model. |
| **localize** | AI | Pins the root cause to `file:line` using the introducing diff as evidence. | — |
| **fix** | AI + run | Generates candidate patches, verifies each in an isolated git worktree, in parallel. | **Gate A:** repro flips red → green. **Gate B:** full suite stays green. Only a patch passing both survives. |

The verification gate is the product. A repro you can't make fail, you can't prove you fixed.

## Install

```bash
pnpm add -g git-replay   # or npm i -g git-replay
```

The package is `git-replay`; the installed command is `replay`.

## Quick start

```bash
cd your-repo
replay init --test "npm test"        # writes .replay/ and wires up .gitignore
# add a credential to .replay/.env.local, then:
replay run "describe the bug, paste a stack trace, or pass a path to an issue file"
```

`replay init` requires a git repository (replay bisects and uses worktrees). It creates:

```
.replay/
  replay.config.json   # committed — test command, models, bisect bounds, candidate count
  INFO.md              # committed — project context injected into every agent prompt
  .env.local           # gitignored — your credential
  data/                # gitignored — per-run checkpoints and artifacts
```

> **INFO.md matters.** It is injected into every agent prompt. Vague content here means vague root-cause analysis — fill it in.

## Output

Every run leaves a bundle in `replay-out/`:

```
replay-out/
  repro.test.txt   # a test that fails on the old code, passes on the fix
  fix.patch        # the verified change
  bisect.log       # "introduced at a3f9c2e by Dana Lee"
  root-cause.md    # file:line evidence trail
```

Drop `repro.test` into your suite and this exact bug can never silently come back.

## Walkthrough

A concrete run against an Express app whose upload handler started 500ing on empty files:

```bash
replay run "Issue #482: uploading a 0-byte file 500s the server"
```

1. **reconstruct** — writes a test that POSTs an empty buffer and asserts a 2xx, runs it in a worktree at HEAD. It returns 500, so the test fails. Red — the bug is real.
2. **bisect** — replays that test across history in a worktree until it finds the commit that turned it red: the one that added size-validation middleware.
3. **localize** — pins `src/upload.ts:88`, where `if (file.size)` treats `0` as falsy and skips initialization.
4. **fix** — proposes candidates (e.g. `if (file.size === undefined)`), applies each in its own worktree, confirms the repro flips green and the suite stays green, and keeps the one that passes both gates.

The result is the `replay-out/` bundle above — a PR-ready fix plus a permanent regression test, in minutes.

## Authentication

`replay` resolves a credential at startup and runs the right backend for it. For API-key and gateway paths it expands a single credential into the four environment variables the SDKs read (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`) — so one [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key covers both Claude and Codex. For the subscription path it drives the Claude or Codex agent directly, so the agent owns its own session — exactly how [deepsec](https://github.com/vercel-labs/deepsec) does it.

Credentials are resolved in precedence order:

1. **Explicit provider keys** (highest priority — bring your own key, direct to the provider)
   ```
   ANTHROPIC_AUTH_TOKEN=sk-ant-...
   ANTHROPIC_BASE_URL=https://api.anthropic.com
   OPENAI_API_KEY=sk-...
   ```
   An explicit key for the active backend always wins over gateway expansion.

2. **Vercel AI Gateway** — one key for everything, works in CI:
   ```
   AI_GATEWAY_API_KEY=vck_...
   ```
   or an OIDC token via `npx vercel link && npx vercel env pull`, which writes `VERCEL_OIDC_TOKEN` to `.env.local`. OIDC tokens expire after 12h; re-pull when a call returns 401 (replay tells you to).

3. **Local subscription session** (`claude login` / `codex login`) — evaluation only. When no API key or gateway credential is present, replay drives the logged-in agent CLI through its own SDK (`@anthropic-ai/claude-agent-sdk` / `@openai/codex-sdk`); the agent uses your subscription session and replay never touches the OAuth token. Subscriptions lack the capacity for sustained runs, so replay warns when it falls back to one.

`.env.local` is parsed leniently — `export` prefixes, quotes, a UTF-8 BOM, and CRLF line endings are all handled.

## Configuration

`.replay/replay.config.json`:

```json
{
  "defaultAgent": "claude",
  "models": {
    "reconstruct": "claude-opus-4-8",
    "localize": "claude-opus-4-8",
    "fix": "claude-opus-4-8"
  },
  "testCommand": "npm test",
  "setupCommand": "npm ci",
  "reproTimeoutMs": 120000,
  "suiteTimeoutMs": 600000,
  "bisect": { "maxCommits": 500, "bad": "HEAD" },
  "fix": { "candidates": 3, "concurrency": 3 },
  "maxThinkingTokens": 16000
}
```

CLI flags override config per run: `--candidates`, `--concurrency`, `--good`, `--bad`, `--root`.

## Commands

```
replay init [--test "<cmd>"] [--force]
replay run "<bug>" [--candidates <n>] [--good <ref>] [--bad <ref>]
replay reconstruct "<bug>"    # stop after the repro gate
replay bisect "<bug>"         # stop after finding the introducing commit
replay localize "<bug>"       # stop after pinning the root cause
replay fix "<bug>"            # run the whole pipeline through the fix gates
```

Each stage checkpoints. Re-running the same bug resumes from the last completed stage — if a run halts on quota, top up and run the same command again.

`<bug>` can be inline text or a path to a `.md`/`.txt`/`.log` file.

## Design notes

- **Resumable everywhere.** Every stage writes `state.json` atomically; a halted run picks up where it left off. Corrupt state fails with a clear message instead of a stack trace.
- **Graceful quota exhaustion.** On a 402/429 the run stops, tells you where to top up, and exits non-zero — re-run to resume.
- **Worktree isolation, end to end.** Reconstruct, every bisect probe, and every candidate fix run in their own detached git worktree, removed afterward — your working tree is never written to, and parallel attempts never collide. Worktree cleanup never masks the underlying error.
- **Honest patches.** `fix.patch` is captured with the repro test excluded and newly-created files included, so it is exactly the change that fixes the bug — nothing more, nothing less.
- **Bounded bisect.** Bisect stops after at most `span + 2` probes and reports non-convergence (flaky repro, skipped/merge commits) instead of looping.
- **Shallow-clone aware.** replay operates only on your local `.git` — it never contacts GitHub or any remote, so private repos need no token (if you can run the tests locally, replay works). On a shallow clone (common in CI) it refuses to bisect rather than blame the wrong commit, and tells you to `git fetch --unshallow`.
- **Partial-failure tolerance.** A candidate that errors or returns malformed output is logged and skipped; the rest still race to pass the gates.
- **`.gitignore` hygiene.** `data/` and `.env.local` are ignored automatically; only config and `INFO.md` travel with the code.

## Development

```bash
pnpm install
pnpm dev -- run "a bug"   # run from source
pnpm typecheck
pnpm test
pnpm build
```

Tests live in [`test/`](test/) and cover the deterministic core — credential precedence, git/worktree mechanics, config loading, checkpointing, argument parsing, and agent-output parsing — with no network calls. CI runs typecheck, lint, tests, and build across Node 18/20/22.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports go through [SECURITY.md](SECURITY.md), not public issues. Releases publish to npm via [trusted publishing (OIDC)](.github/workflows/publish.yml) — no tokens are stored.

## License

MIT © BankkRoll — see [LICENSE](LICENSE).
