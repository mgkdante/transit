# YESID VISUAL SPEC — Measured from production https://yesid.dev

**Method:** BROWSER-MEASURED via Chrome MCP `javascript_tool` + `getComputedStyle` on live production elements, cross-checked against source in `/home/mgkdante/Yesito/projects/yesid.dev/apps/web` (READ-ONLY). Every value below is either MEASURED (live computed px) or SOURCE (token/CSS declaration). Where they disagree it is DPR sub-pixel rounding — the **source declaration is authoritative** and noted.

**Environment caveats:**
- Live browser viewport reported `innerWidth = 2007px`, `devicePixelRatio = 1.25`. `resize_window` moved the OS window but the page's inner viewport stayed ~2007px (fixed remote display). Desktop-tier values (≥1024px breakpoint) all fire at this width. Border widths declared `2px` measure as `1.6px`/`2.4px` due to DPR 1.25 rasterization — SOURCE value `2px` is authoritative.
- Theme toggled to `light` via `document.documentElement.setAttribute('data-theme','light')` for light-grid measurement, then restored to `dark`.
- Token source of truth: `apps/web/src/lib/styles/tokens.css` (generated from `packages/tokens/tokens.json`). Semantic layer: `apps/web/src/app.css`.

---

## 1. Floating nav pill

Source: `apps/web/src/lib/components/layout/Nav.svelte` (`.nav-pill`, lines 175–189). Measured on `[data-testid="nav-pill"]` at home, viewport 2007px.

| Property | MEASURED (computed) | SOURCE (token / decl) | Notes |
|---|---|---|---|
| Element | `<div data-testid="nav-pill">` inside `<nav class="fixed left-0 right-0 flex flex-col items-center">` | Nav.svelte:91–100 | Pill is centered flex child of a full-width fixed `.nav-root` |
| Height | **71.2px** | — | Intrinsic; = 44px min-h content + 12px×2 vertical padding − border. Layout comment (Nav.svelte:123) calls it "~60px"; actual rendered is 71px at desktop wordmark size |
| Width | 580.5px (content-driven, 3 links) | — | Not fixed; grows/shrinks with content |
| Padding (desktop) | **12px 28px** | `padding: 12px 28px` (Nav.svelte:182) | H=28, V=12 |
| Padding (compact / menu-open) | 12px 20px | `.nav-pill-compact` (Nav.svelte:186) | |
| Padding (≤767px) | 8px 16px | Nav.svelte:230 | |
| Padding (≤479px) | 6px 8px | Nav.svelte:251 | |
| Padding (≤359px) | 6px 4px | Nav.svelte:274 | |
| Border-radius | **9999px** (full capsule) | `var(--radius-pill)` = `9999px` (tokens.css:64) | |
| Backdrop-filter | **blur(16px)** (+ `-webkit-backdrop-filter`) | `backdrop-filter: blur(16px)` (Nav.svelte:177–178) | |
| Border | 1.6px measured → **2px solid** | `border: 2px solid var(--border-brand)` (Nav.svelte:179) | DPR rounding; 2px authoritative |
| Border color | `srgb(0.878 0.471 0 / 0.45)` = **#E07800 @ 45%** | `--border-brand: color-mix(in srgb, var(--primary) 45%, transparent)` (tokens.css:80) | primary = `#E07800` |
| Background | `srgb(0.078 0.078 0.078 / 0.92)` (≈ #141414 @ 92%) | `background: color-mix(in srgb, var(--background) 92%, transparent)` (Nav.svelte:176) | `--background` dark = `#141414` |
| Box-shadow | **`rgba(0,0,0,0.5) 0 4px 30px, rgba(255,255,255,0.03) 0 0 0 1px`** | `var(--shadow-nav)` = `0 4px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)` (tokens.css:70) | |
| Box-shadow (compact) | none | `.nav-pill-compact { box-shadow: none }` (Nav.svelte:187) | |
| Top offset | **16px** (`.nav-root top: calc(1rem + env(safe-area-inset-top))`) | Nav.svelte:169 | 1rem = 16px |
| Max-width | none (centered, content width) | — | Nav is `left-0 right-0 flex flex-col items-center`; pill is intrinsic |
| Item gap (pill root) | `gap: 0` | Nav.svelte:99 (`gap-0`) | Spacing comes from dividers + link gaps, not pill gap |
| Link gap (`.nav-links`) | **28px** desktop | `gap: 28px` (Nav.svelte:217); 18px ≤767, 7px ≤479, 2px ≤359 | |
| Divider | width **2px**, height **18px**, margin-inline **20px**, bg #E07800@45% | Nav.svelte:205–212 (10px ≤767, 4px ≤479, 2px ≤359) | Orange vertical delimiters |
| z-index | **50** (rises to 70 when menu open) | `style:z-index={overlayActive ? 70 : 50}` (Nav.svelte:94); `--z-nav: 70` (tokens.css:90) | |
| Nav clearance under pill | **88px** (5.5rem) | `--nav-clearance: 5.5rem` on `.circuit-grid`; `.pt-nav-clear` padding-top (+layout.svelte:127–132) | Every non-full-bleed page top-pads by this |

### Nav item / active treatment
| Property | MEASURED | SOURCE |
|---|---|---|
| Link font-size | 15px (0.9375rem) desktop | `--text-nav-link-desktop: 0.9375rem`; mobile 0.875rem, compact 0.8125rem (tokens.css:50–52) |
| Link font-weight | 500 | Nav.svelte:331 |
| Link color (rest) | `#999` (`--secondary-foreground`) | Nav.svelte:131 `text-secondary-foreground` |
| Link color (active/hover) | `--primary` #E07800 | Nav.svelte:130 `text-primary` |
| Wordmark font-size | 18px (1.125rem) desktop | `--text-nav-brand-desktop: 1.125rem` (tokens.css:48); font-heading, bold |
| Min hit area | 44px (`min-h-11`) on wordmark, links, toggles | Nav.svelte:105/129, menu-toggle min-h/min-w 44px (Nav.svelte:382–383) |
| Active "you are here" dot | 3px×3px circle, `bottom: 4px`, centered, bg `--accent` (#FFB627) | `.nav-pill-link[aria-current='page']::after` (Nav.svelte:351–361) |
| Active link glow (text-shadow) | `0 0 8px glow@50%, 0 0 16px glow@20%` | `.nav-link-active` (Nav.svelte:366–368); glow = #E07800 |
| Hover link glow | `0 0 8px glow@60%, 0 0 20px glow@30%` | `.nav-link-glow` (Nav.svelte:363–365) |
| Theme toggle | 44×44 transparent, no radius, color #999 | `.theme-toggle` measured; ThemeToggle.svelte |
| Menu hamburger | lines 1.5px tall, radius-pill; top 16px wide, bottom 11px; morph to ✕ via ±3.25px translate + 45° | Nav.svelte:388–418 |

---

## 2. Section vertical rhythm

**Home page structure:** full-viewport scroll panels (each `min-height: 100vh` ≈ 1063px at this display), NOT a padding-stacked flow. Rhythm = panel min-height + the section's own internal top/bottom padding. Measured top-level sections at home:

| Section (class) | MEASURED padding-top / bottom | min-height | SOURCE |
|---|---|---|---|
| `.services-section` | **96px / 96px** | 1063px (100vh) | HomeServices.svelte |
| `.proof-reel-section` | 42.528px / 42.528px | 1063px | clamp-derived; ProofReel |
| `.closer-section` | 96px / 100px | 1063px | HomeCloser.svelte |
| `.manifesto` | 0 / 0 (panel; inner content self-spaces) | 1063px | Manifesto.svelte |
| hero (`.hero-section-reserve`) | 0 / 0 | 1063px (100vh) | HeroBanner |

**Section-rhythm design tokens (the intended rhythm knobs):**
| Token | Value | Resolves to (2007px) |
|---|---|---|
| `--space-section-y` | `clamp(3rem, 8vw, 6rem)` (tokens.css:58) | 96px (capped at 6rem) |
| `--space-page-x` (horizontal gutter) | `clamp(1.5rem, 4vw, 5rem)` (tokens.css:57) | 80px (capped at 5rem) |
| `--space-card-gap` | `clamp(1rem, 2vw, 1.5rem)` (tokens.css:59) | 24px (capped at 1.5rem) |

**Detail-page rhythm** (project/blog, see §5): body grid `padding-block: 2.5rem` (40px) desktop / 1.5rem (24px) mobile; section blocks `margin-bottom: 1rem` (16px); prose headings `margin-top: 2.5rem` (app.css `.prose-dark :is(h1..h4)` line 534) / detail section-body `h3 margin: 24px 0 16px` (ProjectDetailPage.svelte:659–664). CTA area `margin-top: 1rem` (ProjectDetailPage.svelte:561).

Verdict: home rhythm is **viewport-panel driven** (100vh scroll snaps) with 96px internal section padding; detail rhythm is **token-driven** (40px block, 16px inter-section, 24–40px heading rhythm).

---

## 3. Card treatment

Source: `apps/web/src/lib/components/ui/card/card.svelte` (`.card-surface`, lines 33–44). Measured on live `[data-slot="card"]` / `.card-surface`.

| Property | MEASURED | SOURCE (token / decl) |
|---|---|---|
| Border-radius | **12px** | `var(--radius-lg)` = `12px` (tokens.css:62, card.svelte:36) |
| Border width | 1.6–2.4px measured → **2px** | `border: 2px solid var(--border-brand)` (card.svelte:35); 2px authoritative |
| Border color (rest) | #E07800 @ 45% (`srgb 0.878 0.471 0 / 0.45`) | `--border-brand` = primary@45% (dark). Light theme = primary@60% (app.css:377) |
| Background | **#1a1a1a** (`rgb(26,26,26)`) dark | `var(--surface-2)` → `var(--card)` = `#1a1a1a` dark / `#F9FAFD` light (tokens.css:76,119,163). SOLID hex always — alpha forbidden so grid never bleeds through |
| Box-shadow (rest) | **`inset 0 1px 0 rgba(245,245,240,0.05)`** (top bevel catch-light) | `box-shadow: inset 0 1px 0 var(--edge-highlight)` (card.svelte:37); `--edge-highlight` dark = foreground@5%, light = rgba(255,255,255,0.6) |
| Border color (hover) | #E07800 @ 85% | `--border-brand-active` = primary@85% (card.svelte:42, tokens.css:81) |
| Box-shadow (hover) | **`srgb(0.878 0.471 0 / 0.06) 0 8px 32px` + `inset 0 1px 0 edge-highlight`** | `box-shadow: var(--shadow-section), inset 0 1px 0 var(--edge-highlight)` (card.svelte:43); `--shadow-section` = `0 8px 32px color-mix(primary 6%)` (tokens.css:69) |
| Transition | border-color + box-shadow, `--duration-normal` (200ms) `--ease-default` | card.svelte:38–39 |
| Inner padding (default) | 16px top / 20px left (per-card content) | measured; card size default `py-4` |
| `--radius-card` token | **does not exist**; cards use `--radius-lg` (12px) directly | tokens.css has radius-sm/md/lg/xl/pill only |

Other card-like surfaces (services-card, home-section panels) share the same `--surface-2` bg + `2px --border-brand` + `--shadow-section` hover recipe (HomeServices.svelte:257/269, ProjectCard.svelte:495).

---

## 4. Background grid (circuit-grid)

Source: `apps/web/src/app.css` `.circuit-grid` (lines 313–321), applied on the root wrapper `+layout.svelte:103`. Colors from `--grid-*` tokens (tokens.css:143–146 dark / 187–190 light). It is a **5-layer repeating-linear-gradient**, drawn as the wrapper's own background-image (solid surfaces occlude it, transparent sections show it through). Opacity is baked into the token color-mix — element `opacity: 1`.

### DARK theme (MEASURED — computed backgroundImage on `.circuit-grid`)
| Layer | Spacing | Direction | Color | MEASURED alpha |
|---|---|---|---|---|
| Block marker | 400px | 90° (vertical lines) | `--grid-block-marker` = accent(#FFB627) @ **4%** | `srgb(1 0.714 0.153 / 0.04)` |
| Major (H) | 80px | 90° | `--grid-line-major` = primary(#E07800) @ **6%** | `srgb(0.878 0.471 0 / 0.06)` |
| Major (V) | 80px | 0° | same @ 6% | same |
| Minor (H) | 16px | 90° | `--grid-line-minor` = foreground(#F5F5F0) @ **2.5%** | `srgb(0.961 0.961 0.941 / 0.025)` |
| Minor (V) | 16px | 0° | same @ 2.5% | same |

Background color under grid: `#141414`. Each line is 1px wide (0→1px opaque, 1px→spacing transparent).

### LIGHT theme (MEASURED after toggling `data-theme="light"`)
| Layer | Spacing | Color | MEASURED alpha |
|---|---|---|---|
| Block marker | 400px | `--grid-block-marker` = accent-text(#815D00) @ **6%** | `srgb(0.506 0.365 0 / 0.06)` |
| Major (H+V) | 80px | `--grid-line-major` = foreground(#131923) @ **8%** | `srgb(0.075 0.098 0.137 / 0.08)` |
| Minor (H+V) | 16px | `--grid-line-minor` = foreground(#131923) @ **4%** | `srgb(0.075 0.098 0.137 / 0.04)` |

Background color under grid (light): `#F3F6FB`. `--grid-glow` = transparent in light (dark = primary@5%, but the page recipe does NOT use grid-glow — it belongs to the hero-intro lamp only; app.css:296–299).

**Headline grid opacity:** DARK major-line = **6%** (orange), minor = 2.5% (off-white), block = 4% (amber). LIGHT major-line = **8%** (ink), minor = 4% (ink), block = 6% (brown). Light grid is ~1.3–1.6× stronger than dark.

**Related grids:**
- Manifesto grid (`.manifesto__circuit-grid`, Manifesto.svelte:230): 80px H+V only, primary @ 6% (bolder home-art variant).
- Detail-header dot-grid (`.detail-header-grid`, app.css:331–347): 80px lines @ `--header-accent` 3.5% + solder-dot radial pattern (320px tile).

---

## 5. Detail-template columns

Two distinct templates. Both are `display:grid`, mobile single-column, desktop 3-column. `--space-page-x` gutters, `--space-card-gap` (mobile) / 2rem (desktop) gap.

### Project detail — `.detail-body` (ProjectDetailPage.svelte:571–605)
| Breakpoint | grid-template-columns | gap | padding-block | padding-inline |
|---|---|---|---|---|
| Mobile (<1024) | `1fr` (side columns `display:none`) | `--space-card-gap` (24px) | 1.5rem (24px) | `--space-page-x` (80px @2007) |
| **Desktop (≥1024)** | **`1fr 2fr 1fr`** | **2rem (32px)** | 2.5rem (40px) | `--space-page-x` |
| MEASURED @2007px | **`443.2px 886.4px 443.2px`** | 32px | 40px | 80px | 
| Columns | TOC rail (left, sticky top 5rem) · sections (center, 2fr) · glance panel (right) | | | |

### Blog detail — `.body-grid` (BlogDetailPage.svelte:300–386)
| Breakpoint | grid-template-columns | gap | max-width |
|---|---|---|---|
| Mobile (<1024) | `1fr` | `--space-card-gap` | `--container-wide` (72rem), margin auto |
| **Desktop (≥1024)** | **`minmax(12rem,1fr) minmax(0,46rem) minmax(12rem,1fr)`** | **2rem** | none (full width) |
| 1024–1279 tweak | same | 1.25rem | side cols stretch |
| Columns | context panel (left, sticky 5rem, width min(18rem)) · sections (center, max 46rem, centered) · entry rail (right, min(18rem)) | | |

Center column caps at **46rem = 736px** (blog) vs 2fr≈886px (project). TOC/context rails sticky at `top: 5rem` (80px) on both.

---

## 6. Article text measure (prose)

Base rule: `app.css .prose-dark` (lines 517–530). Detail pages override font-size via `.blog-section-body` / `.section-body`.

| Property | MEASURED (blog article, ≥1024) | SOURCE |
|---|---|---|
| Prose max-width | **817.594px** computed (= 72ch at 18px Inter) | `.prose-dark { max-width: 72ch }` (app.css:519) |
| Center column cap | 46rem = 736px (`.sections-column`, blog) | BlogDetailPage.svelte:350 |
| Rendered prose width | ~683px (constrained by 46rem column) | measured |
| Measured char width (18px Inter) | 11.36px → 72ch ≈ 818px ✓ | |
| Actual line measure at render | ~60ch (683px / 11.36px) | |
| Body font-size (desktop) | **18px** (1.125rem) | `--text-detail-body-desktop: 1.125rem` (blog/section-body ≥1024, tokens.css:39). Base `.prose-dark` = 1.0625rem(17px)/1.125rem(18px)≥1024 (app.css:519,527) |
| Body font-size (mobile) | 17px (1.0625rem) | `--text-detail-body-mobile` (tokens.css:38) |
| Body line-height | **1.9** (34.2px @18px) desktop / 1.8 mobile | BlogDetailPage.svelte:440/447; app.css .prose-dark 1.85→1.9≥1024 |
| Body color | foreground @ **55%** desktop / 50% mobile (`srgb 0.961 0.961 0.941 / 0.55`) | BlogDetailPage.svelte:439/446 |
| Font family | Inter Variable | `--font-body` |
| **Page H1 (article title)** | **56px**, line-height 53.2px (0.95) | `--text-hero`-ish; blog detail header hero |
| Home hero H1 | 64px (measured, `--text-hero` clamp(4rem,…,8.125rem)) | tokens.css:22 |
| Prose H1 (in-content) | 1.75rem (28px), weight 700 | app.css:538 |
| Prose H2 | 1.5rem (24px), weight 700 | app.css:539 |
| Prose H3 | 1.25rem (20px), weight 600 | app.css:540 |
| Prose H4 | 1.1rem (~17.6px), weight 600 | app.css:541 |
| Detail subheading (h3) | `--text-detail-subheading-desktop` 1.125rem (18px) / mobile 1rem | tokens.css:42–43; ProjectDetailPage.svelte:660 |
| Small text | 0.9375rem (15px) | `--text-small` (tokens.css:29) |
| Caption | 0.8125rem (13px) | `--text-caption` (tokens.css:31) |
| Body token (base) | 1.0625rem (17px) | `--text-body` (tokens.css:28) |

**Headline measure:** prose caps at **72ch (≈818px)**, but sits inside a 46rem (736px) center column so effective line ≈ 60ch / 683px. Body **18px / 1.9 line-height / foreground@55%** on desktop.

Type scale (tokens.css:22–56): hero `clamp(4rem, min(9vw,11svh), 8.125rem)` · display `clamp(2.5rem,5vw,4rem)` · title `clamp(1.75rem,4vw,2.5rem)` · heading `clamp(1.25rem,3vw,1.5rem)` · subheading 1.1875rem · body 1.0625rem · small 0.9375rem · caption 0.8125rem · micro 0.6875rem.

---

## 7. Glow / shadow usage map

All shadow tokens resolved live via probe element. Glow color = `--glow`/`--primary` #E07800 (dark) or accent #FFB627.

| Element kind | Resting shadow | Hover/active glow | SOURCE |
|---|---|---|---|
| **Nav pill** | `--shadow-nav`: `0 4px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.03)` | drops to none when compact | Nav.svelte:181; tokens.css:70 |
| **Cards** (`.card-surface`, services, project, home panels) | `inset 0 1px 0 edge-highlight` (bevel only, NO outer glow at rest) | `--shadow-section`: **`0 8px 32px primary@6%`** + inset bevel | card.svelte:37/43; tokens.css:69 |
| **Nav links** | none | text-shadow glow `0 0 8px glow@60%, 0 0 20px glow@30%` (hover); active `0 0 8px@50%, 0 0 16px@20%` | Nav.svelte:363–368 |
| **Default CTA buttons** (size cta*) | none | `--shadow-glow-sm`: `0 0 6px glow@30%` + `translateY(-1px)` | button.svelte:44; tokens.css:65 |
| **Conversion CTA** (amber) | none | `0 0 6px color-mix(accent 35%)` + `translateY(-1px)` | button.svelte:50 |
| **Live/status dots** (LED) | `rgba(224,120,0,.5) 0 0 4px 1px` | pulse-glow keyframe `0 0 4px→10px` | app.css:399–408 |
| **TOC counter dot** | `accent@40% 0 0 8px` | — | measured `.toc-counter-dot` |
| **Services icon zone** | radial glow bg `primary@22% 0 0 24px` | — | HomeServices.svelte:337 |

**Resolved glow-token values (computed):**
| Token | Computed value |
|---|---|
| `--shadow-glow-sm` | `primary@30% 0 0 6px` |
| `--shadow-glow-md` | `primary@20% 0 0 12px` |
| `--shadow-glow-lg` | `primary@15% 0 0 24px, primary@6% 0 0 60px` |
| `--shadow-section` (card hover) | `primary@6% 0 8px 32px` |
| `--shadow-nav` (pill) | `0 4px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.03)` |
| `--shadow-cta` | `glow@30% 0 0 24px, rgba(0,0,0,.4) 0 4px 12px` |
| `--shadow-cta-hover` | `glow@50% 0 0 40px, rgba(0,0,0,.5) 0 6px 20px` |
| `--shadow-card` (unused on card.svelte; token) | `0 0 16px primary@8%, 0 2px 8px rgba(10,7,4,.35), inset 0 1px 0 edge-highlight` |

**Light-theme shadow overrides** (app.css:360–368): glow mixes halved, warm-ink drop shadows replace black. `--shadow-nav` light = `0 4px 24px rgba(28,24,19,.1), 0 0 0 1px rgba(28,24,19,.04)`; `--shadow-card` light = `0 1px 2px rgba(28,24,19,.06), 0 4px 12px rgba(28,24,19,.08), inset 0 1px 0 edge-highlight`; `--shadow-glow-lg` light = `0 0 24px primary@9%, 0 0 60px primary@4%`.

**Glow philosophy:** NOTHING glows at rest except the nav pill (dark drop) and status LEDs. Glow is a **hover/active affordance only** — cards gain a 6% orange bloom on hover, CTAs a small orange (or amber for conversion) glow + 1px lift, nav links a text-shadow. All glow is orange #E07800 (structural) or amber #FFB627 (conversion CTA only — yellow = conversion doctrine).

---

## Buttons (CTA) — measured supplement
| Variant | radius | padding | bg | fg | font | rest shadow |
|---|---|---|---|---|---|---|
| Default CTA | 12px | 16px 32px | #E07800 (primary) | #141414 | 19px/600 | none (glow-sm on hover) |
| Conversion CTA | 12px | 16px 32px | #FFB627 (amber) | #1C1814 (signage-text/bg pair) | 19px/600 | none (amber glow on hover) |
| Closer CTA | 4px | 16px 28px | #FFB627 | #1C1814 | 15px/600 | none |

CTA size tokens (button.svelte:35–37): cta-sm `px-5 py-2.5 text-small`, cta `px-6 py-3 text-body`, cta-lg `px-8 py-4 text-subheading`.

---

## Color tokens reference (tokens.css)
| Token | DARK | LIGHT |
|---|---|---|
| `--background` | #141414 | #F3F6FB |
| `--foreground` | #F5F5F0 | #131923 |
| `--card` / `--surface-2` | #1a1a1a | #F9FAFD |
| `--muted` | #1E1E1E | #E4E9F3 |
| `--primary` | #E07800 | #A05500 |
| `--accent` | #FFB627 | #FFB627 (accent-text #815D00 light) |
| `--border` | #3A3A3A | #B5BECD |
| `--border-brand` | primary@45% | primary@60% |
| `--secondary-foreground` | #999999 | #454F63 |
| `--muted-foreground` | #949494 | #545E75 |

Note: the LIGHT theme is a cool blue-grey (#F3F6FB paper / #131923 ink), NOT the cream referenced in stale code comments (`--manifesto` #F2E9D8 is the one warm exception). Radii: sm 4 / md 8 / lg 12 (cards) / xl 16 / pill 9999. Durations: instant 100 / fast 150 / normal 200 / slow 300 / slower 500ms. Ease-default `cubic-bezier(.4,0,.2,1)`.
