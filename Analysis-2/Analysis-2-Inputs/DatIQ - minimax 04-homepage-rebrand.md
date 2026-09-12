# Datiq — Homepage Rebrand: Copy + 3 Visual Hero Concepts

**Companion to**: findings.md §1.1 (positioning), `03-pricing-packaging.md` (the new ladder), and the platform expansion strategy.
**Authoring window**: 2026-08-03
**Goal**: Reposition from a single-URL extraction tool to the **Web Intelligence Platform** for the people who work with public web data every day. Three concrete hero concepts, each with copy, layout, and a "what changes" delta vs. the current home.

---

## 1. Positioning thesis

### 1.1 Today

> "DatIQ — Intelligence from every URL."
> "Extract & enrich web data in seconds."
> "No code · Structured in seconds"

The current positioning is a **URL promise**: paste a URL, get structured data. It is honest and narrow. It under-sells the home (which also does batch + schedules + share) and over-sells "intelligence" (most uses are still extraction + summary, not intelligence).

### 1.2 The new thesis

**Datiq turns the public web into a queryable, shareable, alertable surface for the people who work with it every day.** URL extraction is the first action; the rest of the surface is what makes it intelligence: structured outputs, shareable reports, scheduled watches, multi-source enrichment, and (Phase 2+) social listening and brand tracking.

### 1.3 Tagline options — ranked

| Rank | Tagline | Why |
|---|---|---|
| 1 | **"The Web, structured."** | Concrete, category-defining, works for the URL-extraction *and* the social-listening *and* the brand-tracking futures. Short. |
| 2 | **"Web intelligence, end to end."** | Honest about scope. "End to end" carries the platform promise (URL → batch → share → alerts → CRM). |
| 3 | **"From every URL to every signal."** | Bridges the old "every URL" promise to the new social-listening world. Slightly long. |
| 4 | **"Make the web work like a database."** | Punchy and developer-friendly; weak for non-technical personas (Sara, Reggie). |
| 5 | **"The web, queryable."** | Same shape as #1, slightly more developer-coded. |

**Recommendation**: **#1 "The Web, structured."** as the H1 alternative. **#2 "Web intelligence, end to end."** as the subhead. Drop "DatIQ" from the headline (it's a wordmark); reserve for the top nav.

The user's suggestion "Intelligence from Web" is a near-miss — it loses the "every URL" continuity. "The Web, structured" preserves the "URL" through-line (a URL is a piece of the web) and adds a verb (structured) that describes the actual product action. **Stronger than "Intelligence from Web" because it implies a deliverable, not a state.**

---

## 2. Hero concept A — "Single-URL Centered, Outcome Tiles Above"

> **The safest rebrand. The current IA, with new copy.**

### 2.1 Layout

```
+----------------------------------------------------------------+
|  DatIQ                                  Docs  Pricing  Sign in |
+----------------------------------------------------------------+
|  [v2.0 · public beta]                                            |
|                                                                  |
|       The Web, structured.                                      |
|       Web intelligence, end to end.                             |
|                                                                  |
|       [ https://example.com            ] [Extract →]            |
|       Try: example.com  ·  stripe.com/pricing  ·  anthropic.com  |
|                                                                  |
|       6 outcome tiles (unchanged position):                      |
|       [ Build a lead list ] [ Scrape pricing ] [ Competitor intel]|
|       [ SEO audit        ] [ Tech stack     ] [ Job postings  ]  |
|                                                                  |
|       "Used by 5+ research teams and 200+ extraction pros."      |
|       [ Customer logos: ahem — get real ones ]                   |
+----------------------------------------------------------------+
```

### 2.2 Copy

- **Top badge**: `v2.0 · The Social Listening beta is open` (when W11 ships)
- **H1**: `The Web, structured.`
- **Subhead**: `Web intelligence, end to end. Extract, enrich, schedule, share, and now listen — in one workspace.`
- **Composer placeholder**: `Paste a URL, a domain, or a search query`
- **Below the fold** (the "social proof + tiles" block): **unchanged structurally** — the 6 outcome tiles stay where they are. The trust bar gets one new line: "Trusted by analysts, founders, and growth teams at Series A → enterprise."

### 2.3 What changes

- H1, subhead, top badge copy.
- Composer placeholder is widened from "URL only" to "URL, domain, or search query" — pre-empts the Social Listening composer in W12.
- No structural change to the page. Designer can ship in 1 sprint.

### 2.4 Risk

- Doesn't *say* the platform story. A returning user lands and sees the same composer they saw last month. The new copy is the only signal of change.

---

## 3. Hero concept B — "Three Modes, One Home" (recommended)

> **The platform-shaped home. Three composer modes (Single, Bulk, Watch) with a Returning-User rail.**

### 3.1 Layout

```
+----------------------------------------------------------------+
|  DatIQ                                  Docs  Pricing  Sign in |
+----------------------------------------------------------------+
|  [v2.0 · The Social Listening beta is open]                    |
|                                                                  |
|       The Web, structured.                                      |
|       Web intelligence, end to end.                             |
|                                                                  |
|  Tabs:  [ Single URL ]  [ Bulk ]  [ Watch ]  [ Listen (beta) ]  |
|                                                                  |
|  Active tab = Single URL:                                       |
|       [ https://example.com            ] [Extract →]            |
|       Try: example.com · stripe.com/pricing · anthropic.com     |
|                                                                  |
|  6 outcome tiles (unchanged):                                   |
|       [ Build a lead list ] [ Scrape pricing ] [ Competitor intel]|
|       [ SEO audit        ] [ Tech stack     ] [ Job postings  ]  |
+----------------------------------------------------------------+
|  Recent (signed-in only):                                       |
|       Stripe /pricing        2h ago       [ Re-run ] [ Share ]  |
|       Anthropic /careers     1d ago       [ Re-run ] [ Share ]  |
|       Browse AI vs page      3d ago       [ Re-run ] [ Share ]  |
+----------------------------------------------------------------+
|  Templates:  [Scrape 50 SaaS pricing pages]  [Extract YC founders]|
|              [Track 20 competitor job boards]  [Browse all 240 →] |
+----------------------------------------------------------------+
```

### 3.2 Copy (tab-by-tab)

| Tab | H2 | Composer placeholder | Primary CTA |
|---|---|---|---|
| **Single URL** | "One page, structured." | `Paste a URL — we'll pull headings, links, and an AI summary in 30 seconds.` | `Extract →` |
| **Bulk** | "Many pages, one table." | `Paste up to 200 URLs, or drop a CSV. We extract them in parallel and dedupe the result.` | `Extract N URLs →` |
| **Watch** | "Tell me when this page changes." | `Paste a URL, pick a cadence, and we'll email, Slack, or webhook you when it changes.` | `Start watching →` |
| **Listen (beta)** | "Tell me what the web is saying." | `Pick a brand, a competitor, or a keyword. We track mentions across X, Reddit, YouTube, and news.` | `Start tracking →` |

### 3.3 What changes (vs. current home)

- New tab strip — formalizes the four modes the home already half-supports.
- "Recent" rail on the home (the #1 retention fix — Q02, PS 1125).
- Templates row at the bottom of the fold (pre-empts the marketplace).
- New `Listen` tab as the visible launch of the Social Listening beta in W11.

### 3.4 Risk

- The composer becomes 4 tabs — a 2× increase in surface area. The 4 empty states need careful design (mitigation: ship with the Watch overlay, see findings.md §2.6, before the full rebrand).

### 3.5 Why this is the recommended hero

- It tells the platform story **and** the single-URL story.
- It surfaces the templates marketplace (the largest growth lever, M01, PS 104) on the same surface as the extraction product.
- It surfaces the Social Listening beta in W11 without a separate route.
- It is the only hero that holds up for a user on their 1st visit **and** their 50th visit.

---

## 4. Hero concept C — "Outcome Tiles Centered" (sales-led)

> **The "what can Datiq do for you?" home. Best for first-time activation, worst for retention.**

### 4.1 Layout

```
+----------------------------------------------------------------+
|  DatIQ                                  Docs  Pricing  Sign in |
+----------------------------------------------------------------+
|       The Web, structured.                                      |
|       Web intelligence, end to end.                             |
|                                                                  |
|       6 large outcome cards (the "what's your job?" flow):      |
|                                                                  |
|       [ Build a lead list ]    [ Track competitor pricing ]     |
|       [ Audit SEO              ] [ Find job postings          ]  |
|       [ Research a company    ] [ Discover tech stack         ]  |
|                                                                  |
|       Each card opens a pre-wired template (the Q13 + Q11 ship).|
|                                                                  |
|       OR: [ paste a URL and skip the chooser → ]                |
+----------------------------------------------------------------+
```

### 4.2 Copy

- **H1**: `The Web, structured.`
- **Subhead**: `Pick a job. We'll wire the right extraction in 2 clicks.`
- **Card titles** are the user-need versions of the existing 6 tiles:
  - "Build a lead list" (unchanged)
  - "Track competitor pricing" (was "Scrape pricing")
  - "Audit my SEO" (was "SEO audit")
  - "Find open jobs" (was "Job postings")
  - "Research a company" (was "Tech stack")
  - "Watch a page change" (NEW — pre-empts the Watch tab in Concept B)

### 4.3 What changes

- Composer is hidden by default. A "paste a URL and skip the chooser" link is the escape hatch.
- The 6 tiles are now the **first thing** the user sees.
- Each tile leads to a pre-wired template (depends on Q11 + Q13 from P0-W1/W3).

### 4.4 Risk

- **Power users lose**: a returning user has to click a card every time. Mitigation: a "Recent" rail at the bottom + a "Composer" tab in the top nav as the escape hatch.
- **Tiles are 1 click too many for the single-URL job**: a user with one URL now has to pick a card. Mitigation: the "skip the chooser" link is the primary CTA visually.

### 4.5 When to use

- Use Concept C as the **first-visit variant** of Concept B — the same React app, two empty states:
  - First visit (or no recent runs): Concept C
  - Returning visit: Concept B (Recent rail at the top, templates below)
- This is the only design that solves both activation **and** retention.

---

## 5. The 3 visual treatments (parallel to copy)

| | Concept A | Concept B | Concept C |
|---|---|---|---|
| **Visual primary** | A subtle gradient backdrop (current palette: deep indigo → teal). Single subtle animated grid of "page → arrow → table" icons in the background. | A live preview pane to the right of the composer. The preview shows a real Datiq result — "Stripe /pricing → headings + 3 intents + share link" — and updates as the user types. | A mosaic of the 6 outcome tiles, each with a thumbnail of a real Datiq result for that job. The mosaic animates on scroll. |
| **Color direction** | Keep the current palette. The rebrand is copy-only. | Same palette, but the live preview adds a single accent (mint green) on the "Apply" button + shareable-link pill. | Same palette, but each tile gets a 4-color micro-gradient (one per intent: contacts = teal, pricing = amber, SEO = violet, etc.) so the page reads as a "map" of Datiq's surface. |
| **Typography** | H1: 64–80px, semibold, current typeface. | H1: 56–64px, semibold. The tab strip gets a slightly heavier weight to make the four modes legible. | H1: 56px, semibold. Card titles: 24px, regular. Tiles read first, H1 second. |
| **Imagery** | One large product screenshot. The same screenshot used in the help docs. | The screenshot is replaced by a live mini-preview (above). | Six small screenshots, one per tile. Each is a real result for a recognizable site (Stripe /pricing, YC, G2, etc.). |
| **Trust bar** | Logos, testimonial quotes, "Used by 5+ teams and researchers." | Same. Add: "Now in beta: Social Listening." | Same. Add: "Now in beta: Social Listening." |
| **Sticky CTA** | No sticky CTA. The "Extract" button is the only CTA. | A subtle bottom-right "Paste a URL" sticky composer for users who scroll past. | No sticky CTA. The 6 tiles are the CTA. |

## 6. The "Now in beta" badge — what it says about the platform

The badge in all three concepts ("v2.0 · The Social Listening beta is open") is the single most important rebrand asset. It is the first time a user sees a Datiq product *label* that isn't about URLs. It says, plainly, "this product has more than one product inside it." Three words. Ship it.

## 7. Microcopy across the rebrand (consistent with the new home)

| Surface | Current copy | New copy |
|---|---|---|
| Empty Dashboard | "Nothing saved yet" | "Your extracted web is empty. Start with one URL." |
| Composer placeholder | "Paste a URL" | "Paste a URL, a domain, or a search query" |
| Schedules screen H1 | "Schedules" | "Watch the web" |
| Schedules empty state | "Track changes on a page" | "Tell me when a page changes — I'll email, Slack, or webhook you." |
| Watch-a-URL overlay title | "Track changes on a page" | "Watch a URL" |
| Templates empty state | n/a (not shipped) | "Save a successful extraction as a template. Apply it with one click next time." |
| Public gallery page title | "Recent public extractions" | "The public web, structured by the community." |
| Email digest subject | "Your weekly Datiq digest" | "The week the web changed for you." |
| 404 page | "404 — page not found" | "This URL doesn't exist. Want to extract one that does?" |
| Loading state | "Extracting…" | "Reading the page…" (or "Listening for mentions…" on the listening page) |

## 8. What to ship first (and what to wait on)

| Phase | Ship | Why |
|---|---|---|
| **Phase 0 W1** | Concept A copy + the v2.0 badge | Zero layout change; unblocks the pricing page; can be A/B tested against the current copy in W5. |
| **Phase 0 W3** | Concept B tab strip + Recent rail | The tab strip + Recent rail is the highest-ROI retention fix. |
| **Phase 1 W11** | Concept B "Listen" tab | Surfaces the Social Listening beta. |
| **Phase 1 W12** | Concept C as the first-visit variant of Concept B | The activation + retention combo. |

## 9. Open questions

1. **Should "DatIQ" stay or go?** It is pronounceable, distinctive, and one word. Keep it. The wordmark is the only place the brand name appears in the H1; the H1 itself is the product thesis.
2. **Logotype refresh?** Current mark is generic (a stylized "D"). Defer to Phase 2 unless a designer pushes for it.
3. **Localization?** The new copy reads well in EN, ES, FR, DE. Defer formal localization to Phase 2.
4. **Press release?** A platform rebrand with Social Listening beta deserves a launch post. Plan for P1-W12.
