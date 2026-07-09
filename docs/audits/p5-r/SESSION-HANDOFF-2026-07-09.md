# P5-R session handoff — 2026-07-09 (Fable, shipped-to-prod day)

> Next session starts here. Memory: `p5r-redo-program.md` (START HERE) carries the same
> state; this file is the repo-side mirror + the kickoff prompt.

## What is LIVE on transit.yesid.dev (all merged + auto-deployed today)

- **#201** Phase-5 substrate (P5.3a→e + P5.4a→f + historic-cache fix).
- **#202** R1 home: yesid hero geometry + operator variations + provider-identity seam.
- **#203** SQL result-grid trio (fleet status · crowding · busiest lines) + 100dvh hero
  with the navbar inside.
- **#204** Wayfinding by rider questions (merged `4b6544b`; deploy verified at close):
  Where's my bus? · Which line can I trust? · Did they keep their promise? · Behind the
  numbers — each with a plain scope line; What-this-is prose de-jargoned.

## Operator laws (all recorded in memory `p5r-redo-program.md` — BINDING)

1. **Citizens first, vernacular language** — dashboards TELL people things in plain words
   (~8th-grade, no acronyms: no OTP/GTFS//v1 in copy); intuitive > everything.
2. **Lift-then-trim method** — take yesid.dev patterns faithfully, then trim/vary to this
   dashboard's purpose (blessed as "a great example of what we're going to do").
3. **Felt symmetry** — optical balance (both sides equally FULL at a glance) via real
   content mass + centering; NEVER stretching or mechanical equal-heights; edge-to-edge;
   simple.
4. **Provider identity** — runtime = /v1 manifest · SSR = PUBLIC_PROVIDER_* env ·
   build-time = `src/lib/site/deployment.ts`. Never a hardcoded provider string.
5. Standing: one amber-ground CTA per view (map conversion) · chart marks frozen · glow
   never text · EN+FR everything · honest absence · no em dashes in shipped strings ·
   FORBIDDEN guard allowlists EMPTY · Fable runs push/PR/merge/deploy itself.

## P5-R state (Notion slice `3983e863-0690-81cb-b2f0-dbf5b8619711`)

- **R1 home: ~80%.** Remaining = TWO pieces (operator, end-of-day round):

  **(1) WAYFINDING v2 — filterable cards + informational/clickable split (DO FIRST):**
  - Restructure "What this is": the heading + prose in ONE column; Live / Honest /
    Accountable in a SECOND column with their OWN *informational* styling — they must
    NOT look clickable (no card chassis that reads as a button; readers were at risk of
    clicking "Accountable" expecting a page). Clickable destination cards and
    informational pillars must be visibly different species.
  - Add a LEFT RAIL carrying FILTERS for the destination cards (reserve the rail space
    in the layout); cards become filterable (by rider question / live-vs-history /
    whatever classification survives a design pass — keep the four question groups as
    the default view).
  - Redesign the card INTERIOR: today everything stacks left with wasted space — use
    it: bigger fonts, bigger glyphs, longer descriptions where they earn it, nicer
    internal styling. Keep one uniform chassis + content budget (felt symmetry), keep
    icon+label+description+CTA (research law), keep EN+FR.

  **(2) the SCROLL JOURNEY machinery:
  lazy ScrollTrigger/DrawSVG/CustomEase loaders + scrub kit port → 'NEXT STOP: SCROLL
  DOWN' billboard → transit network-schematic SVG draw → --primary viewport takeover →
  cross-fade into the (already-live) thesis hero. PRM/mobile fallback = current page
  as-is. Full spec: `r1-build-brief.md` (LiveNetworkTerminal section = REJECTED, skip).
- **R2–R6 specced** in `parity-register-full.json` (61 gaps, file:line-anchored):
  R2 listing grammar (lines/stops/search: EdgeTitleColumn, BlueprintShell, station
  spines, RouteChain, filter rail, FLIP) · **R3 detail heads + /metrics + /status to the
  EXACT yesid article skeleton (FOCUS buttons · ToC · content — operator's loudest
  requirement)** · R4 dashboards + map chrome · R5 receipt ledger + alerts full-bleed ·
  R6 convergence + ON-PAR deck. Apply the wayfinding doctrine (plain-language labels,
  question-led) to EVERY surface's copy as you touch it.

## Ops state

- **GC2 repair DONE + verified** (route 361 delivered 27>25 → 24≤25; STM+STO rebuilt
  2026-06-26→07-08; marts refresh ran post-rebuild). Runbook steps (a)(b)(b') complete.
- **OPEN: GC2 backfill gap CONFIRMED** — `schedule_version_service_summary` has zero
  populated headway columns and no stm/sto rows (only octranspo, 0 populated). The
  calendar_dates-only backfill job has never run in prod. Needs its own data job.
- **STM API outage** since ~2026-07-09 14:00Z (upstream; unreachable from VM AND WSL).
  Live publishing paused honestly. When it recovers: live resumes and
  `status/data_health.json` should return 200 (worker now runs current main — it was 3
  weeks stale at #176, root cause of the 404). VERIFY the 200 next session.
- **Date-bomb sweep: CLOSED.** Cluster-validated audit of all 8 sibling real-db suites:
  receipts was the ONLY bomb (its fix is on main via #201); the rest are explicit-date /
  edition-anchored / pinned-clock by design. No further changes needed.
- VM access: `ssh ubuntu@100.85.42.33` (tailnet IP — MagicDNS flaky in WSL); docker needs
  sudo; git pull needs an ephemeral `gh auth token` inline. DB at alembic 0078 (head).

## Kickoff prompt (paste into the new session)

See the operator-facing prompt in the session close; short form:
"Continue P5-R (memory p5r-redo-program.md + docs/audits/p5-r/). First verify #204
merged+deployed and prod healthy; check STM API recovery (then data_health.json must be
200). Then R1-final in two PRs: (1) WAYFINDING v2 — filter rail + informational/clickable
split + card-interior redesign (spec in 'P5-R state' above); (2) the SCROLL JOURNEY per
r1-build-brief.md (skip the rejected SQL terminal). Ship each via the PR train (full
battery × browser matrix EN/FR × dark/light × 390). Then R3 (article skeleton EXACT),
then R2, R4, R5, R6 — every page citizen-plain, yesid-lifted, our variations, felt
symmetry."
