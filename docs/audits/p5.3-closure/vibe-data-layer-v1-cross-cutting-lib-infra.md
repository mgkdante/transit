# Vibe + Style Census — Data layer (/v1) + cross-cutting lib infra

**Scope:** `apps/web/src/lib/{v1,filters,i18n,motion,nav,pwa,search,seo,site,stores,styles,utils,vitals,geocode,content}` + `apps/web/src/tests/setup.*.ts`
**Nature of scope:** This is the **data/contract + cross-cutting logic layer**. Of the ~176 scannable files, all but 2 are `.ts` / `.svelte.ts` (repositories, Zod schemas, adapters, stores, motion policy, search/geocode logic). The only true stylesheet files are `styles/tokens.css` (generated token catalog) and `styles/fonts.css` (@font-face). **There are ZERO `.svelte` component files in this scope** — no markup, no class attributes, no inline styles to audit. That is why the off-token hit count is near-zero.
**Task:** READ-ONLY. Find every non-token visual property.

---

## Method & what "canon" means here

Verified the token architecture before flagging:

- `src/lib/styles/tokens.css` — header: `/* GENERATED FROM tools/tokens/tokens.json — DO NOT EDIT */`. This is the **generated token catalog** (the CSS-var definitions everyone else consumes). Its hex/radius/shadow/z/duration/opacity/spacing literals are the **token DEFINITIONS**, not off-token usage. Source of truth = `apps/web/tools/tokens/tokens.json` (exists, verified). Gated by `styles/tokens-aa.test.ts` (WCAG-AA contrast, via `@yesid/gates`). **NOT flagged — this IS the token scale.**
- `src/lib/motion/tokens.ts` — header: `// GENERATED FROM tools/tokens/tokens.json — DO NOT EDIT`. JS mirror of duration/ease tokens for GSAP/actions. Parity-tested. **NOT flagged — canon.**
- `src/lib/styles/fonts.css` — pure `@font-face`, values copied verbatim from `@fontsource-variable` package; family names are the token font stack. No color/space/radius. **NOT flagged — clean.**
- `search/routeColor.ts` — GTFS route brand hex is **contract DATA**, explicitly documented as "the ONE allowed dynamic colour" that no token can carry (arbitrary per-route hue). **NOT flagged — sanctioned exception.**

Greps run across the whole scope (excluding generated `tokens.css` and `/json/` schema fixtures):
- `rgb()/rgba()/hsl()/oklch()` in non-CSS → **0 hits**
- Arbitrary Tailwind `x-[…]` (p-[…], w-[…], text-[…], bg-[#…], rounded-[…], shadow-[…], z-[…], etc.) → **0 hits**
- Inline `style=` attributes → **0 hits** (no components in scope)
- `.style.` / `setProperty(` / `cssText` → **0 hits**
- Tailwind color/utility class strings emitted from logic → **0 hits**
- gradient / backdrop / box-shadow / drop-shadow / blur() / filter: → **0 hits** (2 prose-comment "backdrop" mentions only)
- z-index / opacity numeric literals → **0 hits**
- transition/animation duration strings → **0 hits**
- px/rem/em/vh/vw literals in strings → **3 hits** (all behavioral geometry, see below)
- Hardcoded hex outside tokens.css → **1 real finding** (theme store), plus test-fixture hexes and doc-comment hexes (not runtime).

---

## FINDINGS

### `src/lib/stores/theme.svelte.ts` — the ONE genuine off-token value

| file:line | property | literal value | intent | proposed disposition |
|---|---|---|---|---|
| stores/theme.svelte.ts:24 | `<meta theme-color>` content (dark) | `'#141414'` | address-bar / PWA surface colour for dark theme; the code comment states "These mirror the resolved `--background` token" | **Read from token, don't duplicate.** `--background` dark = `#141414` (tokens.css:97). A `<meta content>` can't take a CSS var, but it CAN be sourced at runtime: `getComputedStyle(document.documentElement).getPropertyValue('--background')`. That kills the drift risk (today a token change silently desyncs the address-bar colour). Alt: emit these two into `tokens.json` as `--theme-surface-{dark,light}` and generate a tiny JS map the same way `motion/tokens.ts` mirrors durations. |
| stores/theme.svelte.ts:25 | `<meta theme-color>` content (light) | `'#F3F6FB'` | same, light theme surface | Same as above — duplicates `--background` light = `#F3F6FB` (tokens.css:164). |

Severity: **low but real.** These are hand-copied duplicates of a token value with a comment openly admitting the coupling — the classic drift trap. Two literals, one fix pattern.

---

### Behavioral geometry constants (px in JS) — borderline, likely INTENTIONAL

These are not "visual styling" (no color/radius/shadow/spacing of a rendered element); they are layout/observer geometry. Listed for completeness; recommend **keep** unless a breakpoint/observer token is ever introduced.

| file:line | property | literal value | intent | proposed disposition |
|---|---|---|---|---|
| nav/layout.svelte.ts:27 | `matchMedia` breakpoint | `'(min-width: 1024px)'` | desktop panel breakpoint; mirrors Tailwind `lg` (1024px) | **Keep / note.** The design system exposes NO `--breakpoint-*` token (verified: none in tokens.css), so there is nothing to map to. This is a JS mirror of Tailwind's `lg`. If breakpoints are ever tokenized, source it from there. Today: acceptable. |
| v1/reliabilitySnapshot.svelte.ts:391 | IntersectionObserver `rootMargin` | `'200px'` | pre-warm reliability badges just below the fold | **Keep.** Pure scroll-prefetch geometry, not a visual property. No token applies. |
| motion/utils/device.ts:6 | `navigator.maxTouchPoints > 0` | `0` | touch-capability probe | **Keep.** Not a visual literal (feature detection). Listed only because the px-grep neighborhood surfaced it. |

---

### Non-runtime hex (test fixtures + doc comments) — NOT violations, listed for auditor completeness

These are not shipped styling; they either exercise `routeColor()` in tests or document token values in comments. **No action.**

| file:line | value | why it's fine |
|---|---|---|
| search/routeColor.test.ts:6,7,11,12,26 | `#009ee0` `#a1b2c3` `#00aaff` `#ffffff` etc. | test assertions for the GTFS-hex normalizer; input DATA, not styling |
| stores/theme.svelte.ts:20,21 | `#141414` `#F3F6FB` (in a `*` doc comment) | comment documenting the constants below (the constants themselves are the finding above) |

---

## Per-module verdicts (all clean unless noted)

| module | files | verdict |
|---|---|---|
| `v1/` (adapter, repositories, schemas, live, http, boot, config, sanitize, stats, resource, reliabilitySnapshot, etc.) | ~58 | **CLEAN.** Pure contract/data logic + Zod. Only `reliabilitySnapshot.svelte.ts:391` rootMargin (geometry, keep). Route brand color handled honestly (data, not token). |
| `filters/` | 6 | **CLEAN.** URL/state codec logic, no visual props. |
| `i18n/` | 4 | **CLEAN.** Routing/config, no visual props. |
| `motion/` | 9 | **CLEAN.** `tokens.ts` = generated canon; `policy.ts`/`view-transition.ts`/`reduced-motion.svelte.ts` = pure gating logic; `wordmarkHover.ts` = re-export of vendored `@yesid/motion`. No ad-hoc durations/easings — all reference the token module. |
| `nav/` | 3 | **CLEAN** except `layout.svelte.ts:27` 1024px breakpoint (Tailwind-lg mirror, no token exists — keep). |
| `pwa/` | 3 | **CLEAN.** SW/version logic, no visual props. |
| `search/` | 6 | **CLEAN.** `routeColor.ts` is the sanctioned dynamic-color guard (data). mapFocus/mapNear/normalize/stopMode/chromeSearch = logic. |
| `seo/` | 2 | **CLEAN.** JSON-LD + route SEO, no visual props. |
| `site/` | 7 | **CLEAN.** absence/config/delayPresentation/securityHeaders/seoFiles/serviceWindow/urlMirror — all logic. `securityHeaders.ts` has CSP strings, not styling. |
| `stores/` | 7 | **theme.svelte.ts = the ONLY finding** (2 hex literals, above). clock/dataPulse/motionMode/persisted/refresh = pure state logic, clean. |
| `styles/` | 2 | `tokens.css` = generated token catalog (canon, not audited as usage). `fonts.css` = @font-face verbatim (clean). |
| `utils/` | 5 | **CLEAN.** cn/format/hash/time — no visual props. |
| `vitals/` | 2 | **CLEAN.** web-vitals collection, no visual props. |
| `geocode/` | 3 | **CLEAN.** Google Places / Nominatim clients, no visual props. |
| `content/nav.ts` | 1 | **CLEAN.** Nav manifest data; 2 "backdrop" mentions are prose. |
| `tests/setup.*.ts` | 2 | **CLEAN.** Test harness. |

---

## Summary numbers

- **Total off-token visual hits: 2** (both in `stores/theme.svelte.ts` — the `#141414` / `#F3F6FB` theme-color meta duplication of `--background`).
- **Borderline behavioral-geometry constants: 3** (1024px breakpoint, 200px rootMargin, maxTouchPoints — recommend keep).
- **By category:** hardcoded hex (off-token) = 2 · arbitrary Tailwind = 0 · inline styles = 0 · rgb/hsl/oklch = 0 · box-shadow/gradient/blur/backdrop = 0 · z-index = 0 · opacity = 0 · ad-hoc transition/easing = 0 · px/rem geometry (borderline) = 3.
- **Generated/canon files correctly excluded:** `styles/tokens.css` (386 hex + full radius/shadow/z/duration/ease/opacity scale — the DEFINITIONS), `motion/tokens.ts` (duration/ease mirror), `styles/fonts.css` (@font-face).
- **Sanctioned exceptions (not violations):** `search/routeColor.ts` (GTFS route brand hex = contract data, the one allowed dynamic colour).

## Hottest files (only one file has real findings)
1. `stores/theme.svelte.ts` — 2 hex literals (the entire real finding set).
_(No other file in scope carries an off-token visual property; there is no meaningful top-10.)_

## 3 most common repeated ad-hoc patterns (candidates to name)
1. **Token value re-hardcoded because the sink can't take a CSS var** (theme-color `<meta content>`). Named pattern: a generated JS surface map (`--theme-surface-*` → `theme/surface.ts`) mirrored from `tokens.json`, same as `motion/tokens.ts` mirrors durations. Would cover this and any future "need the raw value in JS" case.
2. **Breakpoint px inside `matchMedia` strings** (`1024px`). Only one occurrence here, but it recurs project-wide. Candidate: a `--breakpoint-*` token set in `tokens.json` + a generated `breakpoints.ts`, since the design system currently has none.
3. **IntersectionObserver `rootMargin` px** (`200px`). Prefetch geometry, not styling — recommend leaving un-tokenized (it is a behavior tuning knob, not a design decision).

**Overall verdict for this scope: A+ / effectively token-pure.** This is a logic/data layer with no components, so there is almost nothing to get wrong; the one real leak is two theme-surface hex literals that duplicate `--background` and should be sourced from the token instead.
