# R1 · Theatre machinery + the home JOURNEY — build brief

> ## ⛔ TOMBSTONE (operator, 2026-07-09, end of day)
>
> **The scroll JOURNEY below is REJECTED for transit — do NOT build it.** Operator:
> the pinned scroll intro (billboard → schematic draw → orange takeover) is
> yesid.dev-ONLY theatre; it belongs to the portfolio site, never to this citizen
> dashboard. The earlier "re-legalized scroll theatre" ruling covered yesid.dev, and
> reading it as a transit mandate was a misunderstanding. Same standing as the
> LiveNetworkTerminal rejection: keep this note so no session resurrects it from the
> register (§ HOME gap 1) or from the movement list below.
>
> **R1 is COMPLETE** once wayfinding v2 (PR #206: filter rail + informational
> pillars + card redesign) merges. The home = the honest command board, full stop.
> The movement list below is retained as historical reference ONLY.

> Branch `slice/p5r-r1-home-journey`. Notion slice `3983e863-0690-81cb-b2f0-dbf5b8619711` ·
> register: `parity-register-full.json` § HOME + § SITE-WIDE. Every hard law from the plan
> applies (marks frozen · one amber ground CTA per view · glow never text · EN+FR · honest
> absence · PRM-silent) PLUS the operator's FELT-SYMMETRY law (2026-07-09): both sides of a
> composition read equally FULL at a glance — balance via real content mass and centering,
> never stretching or mechanical equal-heights; edge-to-edge; simple; easy navigation.
>
> STATUS: the STATIC hero + sections shipped 2026-07-09 (`3d7bdf1` — the yesid hero geometry
> verbatim: thesis + 3 stat tiles + statement/lede/CTAs | amber spine | live-pulse panel with
> fleet-status readout; uniform explore tiles; level pillar row). **LiveNetworkTerminal (the
> SQL query panel) was REJECTED by the operator — do NOT rebuild it**; the hero right column
> IS the live-pulse TerminalPanel.

## Movements (yesid HomePage.svelte:228-314 is the reference score)

1. **HeroJourney** (scroll-pinned, ≥1024 + motion-ok only) — 'NEXT STOP: SCROLL DOWN' /
   'PROCHAIN ARRÊT : FAIS DÉFILER' mono billboard → transit-native network-schematic SVG
   draw (ornament, aria-hidden, NEVER presented as data) with a traveling --primary dot →
   node zoom → full---primary viewport takeover → cross-fade into the THESIS hero.
2. **Thesis hero** — Masthead with a two-line thesis (operator picks A/B/C; register § HOME
   gap 2 has the EN//FR pairs; audit recommends A: "THE NETWORK, / MEASURED HONESTLY." //
   "LE RÉSEAU, / MESURÉ HONNÊTEMENT."), line 2 in --primary, agency name demoted to
   kicker/CornerMeta + the live-pulse TerminalPanel beside it (SHIPPED).
3. **HonestyManifesto** — full-viewport blueprint-band beat: "WHEN A NUMBER IS MISSING, /
   WE SHOW IT MISSING." // "QUAND UNE DONNÉE MANQUE, / ON L'AFFICHE ABSENTE." at display
   scale + the existing 3 pillars (Live/Honest/Accountable) + a mono prompt line.
4. **Terminus** — today's launchpad (Explore/Accountability/Trust groups KEPT) + the ONE
   amber-ground conversion CTA for this view: "Open the live map" / "Ouvrir la carte en
   direct" → /map.
   Hazard-tape Separator between movements; NumberedChip movement numbers 01/02/03.

## LiveNetworkTerminal — REJECTED (do not build)

Operator (2026-07-09): "you can remove the SQL query" — the panel was built, shipped,
and removed the same day. The signature interaction slot in movement 2 is filled by the
live-pulse TerminalPanel (2×2 KPIs + fleet-status readout). Keep this note so the idea
is not resurrected from the older audit register entry (§ HOME gap 3).

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
