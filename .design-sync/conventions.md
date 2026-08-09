# DatIQ design system — build with the real components

DatIQ is a slate-neutral, indigo-accent product UI (extraction/scraping
SaaS). These conventions come from the real, shipped `src/styles/`
stylesheets and `src/components/` — verified against the compiled CSS, not
guessed.

## Required wrap

**Every composition needs `data-theme="light"` (or `"dark"`) set on an
ancestor element** (`<html>`, or any wrapping `<div>`). This is not
optional polish — `--bg`, `--surface`, `--surface-2`, `--border`, `--text`,
`--text-2`, `--text-3`, and every `--shadow*` token are defined **only**
inside `[data-theme="light"]`/`[data-theme="dark"]` selectors, with no
`:root` fallback. Without it, backgrounds/surfaces/borders/shadows are all
`unset` and the page renders as unstyled black-on-white boxes. The real app
does this via `ThemeProvider` (`src/components/ThemeProvider.jsx`), which
also persists the choice to `localStorage`, but for a new composition
simply setting the attribute is enough:
```jsx
<div data-theme="light">{/* your composition */}</div>
```
Accent color, radius scale, spacing, and font are theme-independent
`:root` tokens (see below) and need no wrapper.

Components that read app state — auth session, billing plan, in-flight
extraction, guest-trial counters — need the matching React context
provider mounted above them (`AuthProvider`, `BillingProvider`,
`ExtractionProvider`, `PersonaProvider`, `GuestTrialProvider`,
`ToastProvider`, `ErrorModalProvider`, all in `src/components/`) or they
throw/render blank. `ToastProvider`/`ErrorModalProvider` in particular are
provider-only — nothing shows until a child calls their hook
(`useToast()`/`useErrorModal()`) — never expect to see their content by
just rendering the provider alone.

## Styling idiom: CSS custom properties + component classes

DatIQ is **not** a utility-class system — Tailwind exists only for
incidental layout glue, never for this design system's own look. Style
with the real CSS custom properties and the real component classes, both
defined in `src/styles/design-system.css` (tokens + primitives) and
`src/styles/screens.css` (everything else, ~7800 lines of per-feature
classes).

**Core tokens** (`:root`, theme-independent):
| Token | Value | Use |
|---|---|---|
| `--accent` | `#4f46e5` (indigo) | primary brand color |
| `--accent-strong` / `--accent-soft` | derived via `color-mix` | hover state / tinted backgrounds |
| `--r-sm` / `--r` / `--r-lg` / `--r-pill` | `9px` / `14px` / `22px` / `999px` | radius scale — **no `--r-md` or `--r-xl`, those don't exist** |
| `--gap` / `--card-pad` / `--row-py` | `22px` / `24px` / `13px` | spacing scale |
| `--font` | `"Hanken Grotesk", ui-sans-serif, …` | loaded at runtime via Google Fonts, not shipped as a local file |

**Theme tokens** (`[data-theme="light"|"dark"]`): `--bg`, `--surface`,
`--surface-2`, `--surface-hover`, `--border`, `--border-strong`, `--text`,
`--text-2`, `--text-3` (**no `--text-1`**), `--shadow-sm`, `--shadow`,
`--shadow-lg`, `--shadow-accent` (**no `--shadow-md`**). A handful of
existing DatIQ components reference `--r-md`/`--r-xl`/`--text-1`/
`--shadow-md`/`--danger` and silently lose that one declaration since
those names were never defined — don't copy that pattern into new work;
use the real scale above (and for a semantic red, DatIQ mostly inlines
`#e0556b` with a `var(--danger, #e0556b)` fallback rather than a defined
token).

**Component classes** follow the component's own name, lowercased —
`.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-danger` (Button),
`.toast` (ToastProvider), `.watchlist-card` (WatchlistCard), and so on.
Read the real source for any component's exact class vocabulary — this
project has no separate utility-class layer to memorize.

## Where the truth lives

- `src/styles/design-system.css` — tokens, `.btn*`, base resets. Read this
  first for anything token-related.
- `src/styles/screens.css` — every other component/page class, organized
  by feature area with header comments.
- Per-component `.prompt.md` in this bundle — real usage notes per
  component, generated from source.

## A real composition

```jsx
import { Button, Toggle, Icon } from "datiq";

function ExampleToolbar() {
  return (
    <div data-theme="light" style={{ display: "flex", gap: 12, padding: 24 }}>
      <Button variant="primary" icon="arrow-up">Run now</Button>
      <Button variant="secondary" iconRight="chevron-down">Export</Button>
      <Toggle label="Auto-run" checked onChange={() => {}} />
    </div>
  );
}
```
