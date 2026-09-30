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

> ~~⚠️ `netlify-cli@27.3.0` and newer currently do **not** resolve at all — they
> depend on `@netlify/dev@^5.0.1`, which floats to the broken `5.0.4`. `27.1.2`
> is the newest version whose tree resolves.~~
>
> **RESOLVED 2026-09-03.** `@netlify/ai@1.0.1` — the version `@netlify/dev@5.0.4`
> required and that had never been published, which is what killed a production
> deploy — has since shipped. The pin moved `27.1.2` → `27.4.2` and the tree got
> **388 packages smaller**. The note above is kept, struck through, because
> re-checking it rather than trusting it is what unblocked the bump.

## `overrides` — why they exist and what they cost

`package.json` carries four `overrides`. They are not cosmetic; without them this
lockfile ships **5+ high** advisories.

| Override | Forces | Why the tree would not get there on its own |
|---|---|---|
| `sharp: ^0.35.4` | sharp 0.35.4 · libvips 1.3.3 | `ipx@3.1.1` declares `sharp@^0.34.3`, and 0.34.x is inside the vulnerable range (`<0.35.0`) for GHSA-f88m-g3jw-g9cj (CVE-2026-33327/-33328/-35590/-35591). The only `ipx` release that moved to `sharp@^0.35.3` is `4.0.0-beta.1` — a **beta**, which has no business in the tool that publishes production. |
| `qs: ^6.16.0` | qs 6.16.0 | 6.15.x is inside the array-limit-bypass / DoS advisory range. |
| `toml: ^4.2.0` | toml 4.2.0 | `@netlify/zip-it-and-ship-it` and `netlify-cli` declare `toml@^3.0.0`, which is vulnerable to GHSA-82x6-q7mm-w9cf (recursion DoS) and GHSA-v5mp-jgw5-2x6j (prototype pollution). |
| `fast-uri: ^3.1.7 \|\| ^4.2.0` | fast-uri 4.2.1 | 3.0.0–3.1.6 and 4.0.0–4.1.3 are inside GHSA-qw65-cvwx-89v3 / GHSA-58mr-gqgx-xq4g (authority injection via unvalidated port). The range spans both majors so each dependent resolves a patched version in its own line (the fastify dev tooling pins 4.x, the CLI's own tree 3.x). Added 2026-09-30. |

**Why `npm audit fix` does not do this for you, and why that is misleading:** it
offered exactly one remedy — `netlify-cli@23.13.5`, a **major downgrade**, four
majors back. That is what "no fix available" looks like when the *top-level*
package has no newer release. It says nothing about whether the vulnerable
*transitive* dependency has a patch. Here it did. **Always check the advisory's
own patched range against the registry before concluding a fix does not exist** —
this repo has now been caught by that assumption three times (see
`.github/gate-bypass/vulnerabilities.json`).

### The residual risk, stated plainly

`sharp@^0.35.4` crosses a minor boundary that `ipx@3.1.1` has not validated
against. That is a real, if small, semver violation.

It is acceptable here for one reason, and it was **tested, not assumed**: this
tree exists solely to run `netlify deploy`, and that command never loads sharp.
Verified by deleting `node_modules/@img` and `node_modules/sharp` from an
otherwise complete install — `netlify --version` succeeded, `netlify deploy
--help` succeeded (loading the deploy command's own module graph), and `netlify
deploy` reached its own argument validation.

⚠️ **The trade:** if anyone ever runs `netlify dev` from *this* pinned tree, its
image transforms may behave differently or break. Nothing in this repository
does — `netlify dev` is not part of any workflow or npm script. If that ever
changes, re-evaluate the override rather than assuming it is still free.

Note also that `--ignore-scripts` in the workflow does **not** keep libvips off
disk: modern sharp ships prebuilt binaries as *optional dependencies*, not as a
postinstall download. The flag saves install time and removes node-gyp from the
release path; it is not a security control.
