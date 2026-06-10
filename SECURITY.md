# Security Policy

## Reporting a vulnerability

Please report security issues privately. **Do not open a public issue for a vulnerability.**

- Use GitHub's [private vulnerability reporting](https://github.com/BankkRoll/replay/security/advisories/new) ("Report a vulnerability" under the Security tab), or
- Email the maintainer listed in the repository profile.

Include enough detail to reproduce: the command run, the repository state, and the observed vs. expected behavior. We aim to acknowledge reports within 7 days.

## Supported versions

replay is pre-1.0. Security fixes are applied to the latest published version on the default branch.

## Security model — what replay does and does not do

replay is a local developer tool. Understanding its trust boundaries matters:

- **It executes code from your repository and from the AI backend.** The `testCommand`, `setupCommand`, and the repro command proposed by the model are run as shell subprocesses (`shell: true`) inside isolated git worktrees. Run replay only on repositories and bug reports you trust, exactly as you would `npm test`.
- **It never contacts a code host.** replay operates only on the local `.git` directory — no `clone`, `fetch`, `push`, or remote access. Private repositories require no token; if you can run the tests locally, replay works.
- **Credentials never touch disk beyond `.env.local`.** API keys and gateway tokens are read from the environment or `.env.local` (which `init` adds to `.gitignore`). For the subscription path, the Claude/Codex agent SDK owns its own OAuth session — replay never reads or stores the token.
- **Generated patches are applied only inside throwaway worktrees**, never to your working tree, until you choose to apply `fix.patch` yourself.

## Hardening recommendations

- Keep `.replay/.env.local` out of version control (the default `.gitignore` does this).
- Review `INFO.md` before committing — it is injected into prompts and travels with the repo.
- Treat `replay-out/fix.patch` as untrusted until reviewed, like any AI-generated change.
