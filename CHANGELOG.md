# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release: `init`, `run`, and per-stage commands (`reconstruct`, `bisect`, `localize`, `fix`).
- Deterministic pipeline: reconstruct → bisect → localize → fix, with red→green test and green-suite gates.
- Credential resolution: explicit provider keys → Vercel AI Gateway key/OIDC → local Claude/Codex subscription.
- Subscription backend drives the Claude Agent SDK / Codex SDK so the agent owns its own session.
- Resumable checkpoints keyed on bug + repo HEAD; isolated git worktrees for every stage.

[Unreleased]: https://github.com/BankkRoll/replay/commits/main
