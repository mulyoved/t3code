---
description: Rebuild and restart the PM2-managed t3code app for this repo.
argument-hint: optional target: web or dev
---

# Restart T3 Code

Rebuild and restart the PM2-managed `t3code` processes for this repository.

When you run this command:

1. Work from the repo root.
2. Inspect the optional argument.
3. If no argument is provided, or the argument is `web`, run `bun run rebuild:restart -- web`.
4. If the argument is `dev`, run `bun run rebuild:restart -- dev`.
5. Report which target was restarted and include the relevant PM2 process names.

Target meanings:

- `web`: rebuilds `apps/web` and restarts the Cloudflare/tunnel-backed PM2 app `t3code-web`
- `dev`: restarts the local PM2 dev apps `t3code-dev-server` and `t3code-dev-web`

Do not make unrelated code changes as part of this command.
