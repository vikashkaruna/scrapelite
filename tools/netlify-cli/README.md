# Deploy toolchain (pinned Netlify CLI)

The Netlify CLI used by the **production deploy and rollback** steps of
[`.github/workflows/phase-gate.yml`](../../.github/workflows/phase-gate.yml),
installed from the `package-lock.json` committed next to this file.

## Why this directory exists

The deploy step used to run `npx --yes netlify-cli`, which resolves `latest`
**and every one of its ~1,160 transitive `^` ranges** against the live npm
registry, at deploy time, on every release.

On **2026-08-27** that broke a release that had passed every gate:

| time (UTC) | event |
|---|---|
| 19:43:59 | `@netlify/dev@5.0.4` published, declaring `@netlify/ai@^1.0.1` |
| — | `@netlify/ai@1.0.1` **has never been published** — `1.0.0` is the newest |
| 20:10:53 | `Deploy to Production` ran, npm answered `ETARGET`, job failed |

Nothing in this repository changed. A third party published a broken package 27
minutes earlier, and the deploy consumed it — after every gate was green, after
manual approval, with production hand-unlocked by an operator who was waiting.

**Pinning `netlify-cli@<version>` would not have prevented this.** The break
arrived through a floating *transitive* range (`@netlify/dev@^5.0.1` → `5.0.4`),
not through the top-level one. Only a lockfile freezes the whole tree, which is
why this is a lockfile and not a version number in a workflow file.

## Why it is not in the root `package.json`

It is ~1,160 packages that nothing outside the production deploy job needs.
Adding it to the root would slow every developer install, every CI test job and
the pre-push hook, to pin a tool none of them run.

## Bumping the version

1. Edit the exact version in `package.json` (exact — no `^`, no `~`).
2. `npm install --package-lock-only --prefix tools/netlify-cli`
3. `npm ci --prefix tools/netlify-cli && ./tools/netlify-cli/node_modules/.bin/netlify --version`
4. Commit **both** files together.

`scripts/deploy-toolchain.test.mjs` fails the build if the pin drifts back to a
range, if the lockfile goes missing or out of sync with `package.json`, or if
the workflow goes back to installing the deploy tool from the registry.

> ⚠️ `netlify-cli@27.3.0` and newer currently do **not** resolve at all — they
> depend on `@netlify/dev@^5.0.1`, which floats to the broken `5.0.4`. `27.1.2`
> is the newest version whose tree resolves. Re-check before bumping past it.
