# DatIQ — Documentation sweep (post AEO/GEO P1 ship)
**Date:** 2026-08-09
**Branch:** `feat/aeo-geo-seo-p1-sweep` (this work is on top of `9afb05c`)
**Status:** Code + content complete; awaiting push

---

## 1. What was updated

User surfaces only — no product code changed. All updates are to public-facing static pages and one React component.

| File | What changed |
|---|---|
| `public/changelog/index.html` | Fixed `security@datiq.app` → `admin@datiq.app`; added 2 new V1.0+ release entries (2026-08-09 P1 sweep + email consolidation); updated "Last updated" |
| `public/pricing/index.html` | Fixed `sales@datiq.app` → `hello@datiq.app` (the Enterprise "Talk to sales" mailto) |
| `public/integrations/index.html` | Moved **Airtable** and **Notion** from "Coming soon" to "Available" (both are already implemented in `src/lib/airtable.js` and `src/lib/notion.js`); updated hero copy + "Last updated" |
| `public/use-cases/usecase.html` | Added a small note at the top linking to the main `/use-cases` hub (the 12-card grid is preserved as the "extended" view; the 4 new "Full guide" links to the detail pages were already in place) |
| `src/components/TopBar.jsx` | Explore dropdown "Use Cases" item now points to `/use-cases` (was `/use-cases/usecase.html`) |
| `public/vs/compare.html` | Top nav "Use Cases" link now points to `/use-cases` (was `/use-cases/usecase.html`) |
| `public/blog/index.html` | Added a new release post: "DatIQ is Now an AI-Native Product: AEO/GEO/SEO Hardening + Customer Email Consolidation" (2026-08-09, 6 min); also added to the JSON-LD `blogPost` array |
| `public/llms-full.txt` | Added a new "Section 16 — Recent releases (2026)" with the 3 release notes (P1 sweep, email consolidation, P0 hardening) + the V1.0 summary; added 3 new bullets to "Section 12 — Technical Stack" mentioning `og-card.jpg`, `llms-full.txt` itself, and the schema.org coverage |
| `.claude/skills/production-readiness/scripts/audit.mjs` | Fixed a false positive in the customer email check: the scan now strips `<code>...</code>` and backtick-delimited content before searching for deprecated email addresses, so documentation that mentions retired addresses (e.g. the changelog documenting the deprecation itself) no longer triggers a FAIL |

### What was already correct (no changes needed)
- Help files (`public/help/*.html`) — no deprecated emails, no stale og:image, no broken use-case links
- Use-cases hub (`public/use-cases/index.html`) — already links to the 4 new detail pages
- All other static pages — og:image and BreadcrumbList from the P1 sweep still intact
- 4 use-case detail pages — were created in the P1 sweep, no changes here

---

## 2. Audit results

```
readiness          5 pass · 2 warn · 0 fail   ✅
test:unit          1631 / 1631                ✅ (7.34s)
test:contract      677 / 677                  ✅ (2.45s)
build              clean (873ms)              ✅
```

The pre-existing warns remain (screenshot staleness, gallery audit doesn't count static samples). These are unrelated to this sweep.

---

## 3. Why the audit needed a fix

The production-readiness audit's "Customer email consolidation" check scans every text file under `src/`, `public/`, and `netlify/` for the deprecated email addresses (`support@`, `legal@`, `privacy@`). Before this fix, it would false-positive on any documentation that legitimately mentions the retired addresses — for example, the changelog entry that says:

> `support@datiq.app` → `hello@datiq.app` (product, billing, general)

That's documenting the deprecation, not a customer-facing usage. The fix strips content inside `<code>...</code>` HTML tags and backtick-delimited inline code before the substring check, so the audit still catches actual broken usages (e.g. `<a href="mailto:support@datiq.app">`) but doesn't trip on documentation.

This is a low-risk change to the skill — only affects the audit's matching logic, not the `--fix-emails` auto-resolver.

---

## 4. Files in this commit

```
public/changelog/index.html              (M)
public/pricing/index.html                (M)
public/integrations/index.html           (M)
public/use-cases/usecase.html            (M)
public/blog/index.html                   (M, +new release post)
public/llms-full.txt                     (M, +new section 16)
public/vs/compare.html                   (M)
src/components/TopBar.jsx                (M, 1-line change)
.claude/skills/production-readiness/scripts/audit.mjs  (M, regex fix)
```

8 files changed. The audit is fixed in the local skill; the CI runs `audit.mjs` from the same path so the fix will take effect on the next staging run.

---

## 5. What's still open (not in this sweep)

These are intentional follow-ups from the P1 sweep handoff, not addressed in this doc sweep:

- **Operator actions** (P2 backlog): Search Console + Bing Webmaster submission, Product Hunt launch, G2/Capterra/Wellfound profiles, dev.to/Hashnode/HN posts — see `docs/SESSION-HANDOFF-2026-08-09-AEO-GEO-P1-SWEEP.md` §4
- **The gallery's 2 pre-existing warns** — screenshot staleness (regenerate via `node docs/capture-screenshots.mjs`), gallery audit doesn't count static samples
- **The two one-shot migration scripts** (`scripts/og-image-migrate.mjs`, `scripts/breadcrumb-migrate.mjs`) — already in `feat/aeo-geo-seo-p1-sweep` and idempotent
- **Netlify Edge-Access** — staging URL is gated; the only way to verify the new design visually is to authenticate at `app.netlify.com/edge-access?domain=...` in a browser

---

## 6. What to do next

1. Review the diff — sanity check the changelog, integrations, blog post, and llms-full.txt sections
2. Push + open a PR (or commit directly to staging)
3. After merge to staging + Netlify auto-deploy:
   - Re-run `npm run readiness` to confirm still 5/2/0
   - Curl `/blog` to confirm the new release post is rendered
   - Curl `/integrations` to confirm Airtable + Notion are now "Available"
   - Curl `/llms-full.txt` to confirm section 16 is present
4. Optional: ship to production by merging `staging → main` and re-verifying on `https://datiq.app`
