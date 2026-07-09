# R1 · Theatre machinery + the home JOURNEY — build brief

> Branch `slice/p5r-r1-home-journey` (off the substrate stack tip `66eb4a8`; rebases onto
> main trivially once the operator merges the substrate). Notion slice
> `3983e863-0690-81cb-b2f0-dbf5b8619711` · register: `parity-register-full.json` § HOME +
> § SITE-WIDE. Every hard law from the plan applies (marks frozen · one amber ground CTA
> per view · glow never text · EN+FR · honest absence · PRM-silent).

## Movements (yesid HomePage.svelte:228-314 is the reference score)

1. **HeroJourney** (scroll-pinned, ≥1024 + motion-ok only) — 'NEXT STOP: SCROLL DOWN' /
   'PROCHAIN ARRÊT : FAIS DÉFILER' mono billboard → transit-native network-schematic SVG
   draw (ornament, aria-hidden, NEVER presented as data) with a traveling --primary dot →
   node zoom → full---primary viewport takeover → cross-fade into the THESIS hero.
2. **Thesis hero** — Masthead with a two-line thesis (operator picks A/B/C; register § HOME
   gap 2 has the EN//FR pairs; audit recommends A: "THE NETWORK, / MEASURED HONESTLY." //
   "LE RÉSEAU, / MESURÉ HONNÊTEMENT."), line 2 in --primary, agency name demoted to
   kicker/CornerMeta + **LiveNetworkTerminal** beside it (see below).
3. **HonestyManifesto** — full-viewport blueprint-band beat: "WHEN A NUMBER IS MISSING, /
   WE SHOW IT MISSING." // "QUAND UNE DONNÉE MANQUE, / ON L'AFFICHE ABSENTE." at display
   scale + the existing 3 pillars (Live/Honest/Accountable) + a mono prompt line.
4. **Terminus** — today's launchpad (Explore/Accountability/Trust groups KEPT) + the ONE
   amber-ground conversion CTA for this view: "Open the live map" / "Ouvrir la carte en
   direct" → /map.
   Hazard-tape Separator between movements; NumberedChip movement numbers 01/02/03.

## LiveNetworkTerminal (buildable now, no GSAP — the signature interaction)

`features/home/LiveNetworkTerminal.svelte` inside `<TerminalPanel>`:
- Mono, syntax-colored QUERY text (display-only; describes the real client-side compute):
  `SELECT route, count(*) vehicles, median(|delay|) delay_p50 FROM live.vehicles GROUP BY route ORDER BY vehicles DESC LIMIT 5`
- RESULTS table computed client-side: facet `live.index.vehiclesByRoute`
  (v1/live/index.ts:46) → per-route `aggregateLive(facet)` (v1/live/aggregate.ts:78) →
  top-5 by count; columns route · vehicles · delay_p50 (AbsentValue on null — honest-null,
  never a fabricated 0). Footer readout: N rows · total vehicles · FreshnessStamp.
- "PULL FRESH DATA" / "ACTUALISER LES DONNÉES" button → `live.refresh()`
  (v1/live/store.svelte.ts:86), spinner on the glyph while settling. Ground = --primary
  gradient (yesid HeroBanner:615-627 grammar). NOT amber (amber = the terminus map CTA).
- EN+FR copy in the home copy module; unit tests: faceting/top-5 selector (pure), refresh
  wiring, honest-null rendering.

## Machinery (gap 1 + site-wide § gap 1)

- `motion/utils/gsap.ts`: add lazy `loadScrollTrigger/loadDrawSVG/loadCustomEase` dynamic
  imports (mirror yesid's loaders; keep the chrome bundle lean). Scrub kit
  (createHeroTimeline/createCrescendoScrub/createDrawScrub/backgroundBreathing) ported
  transit-local `src/lib/motion/scrubs/` — all self-no-op under prefers-reduced-motion.
- `static/images/network-schematic.svg`: Beck-style trunk-route line drawing (drawable
  strokes, one traveling-dot path).

## Fallback law (non-negotiable)

PRM / <1024 / JS-off: the pinned journey never mounts — the page renders the CURRENT
command board (hero + pulse + pillars + launchpad) exactly as shipped. The journey is an
enhancement layer; the honest board is the baseline experience.
