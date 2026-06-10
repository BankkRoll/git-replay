# Contributing to replay

Thanks for your interest in improving replay.

## Development setup

```bash
pnpm install
pnpm dev -- run "a bug description"   # run the CLI from source
```

## Before opening a PR

Run the full gate locally — CI runs the same checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All four must pass.

## Project layout

```
src/
  cli/        argument parsing, command dispatch, init
  lib/        config, auth, git/worktree, exec, checkpoint, pool, logger, errors
  lib/agents/ backend implementations (REST SDK, Claude Agent SDK, Codex SDK)
  stages/     reconstruct → bisect → localize → fix, plus the pipeline
test/         unit + integration tests for the deterministic core
```

## Principles

- **The gate is the product.** Anything that loosens a verification gate (the repro must fail, the fix must flip it green, the suite must stay green) needs a strong justification and tests.
- **Never write to the user's working tree.** All command execution happens in detached worktrees.
- **Resumable and idempotent.** Every stage checkpoints; re-running must skip completed work.
- **Errors are `ReplayError`s with hints.** A failure should tell the user what to do next.

## Tests

Tests live in [`test/`](test/) and cover the deterministic core without network calls. New behavior should come with a test. Integration tests that touch git create ephemeral repositories in the OS temp directory and clean up after themselves.

## Commit messages

Use clear, imperative subject lines (e.g. "Capture fix patch with repro excluded"). Keep changes focused.
