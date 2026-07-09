# P5-R kickoff — OPERATOR RUNBOOK (2026-07-09)

> Everything below is OPERATOR-RUN (push/PR/merge/deploy are yours). Written at the close of
> the 2026-07-09 Fable session that (a) re-reviewed the last 3 QA commits (verdict: no redo;
> P5.4f fix-list applied), (b) fixed the historic-tier cache, (c) closed the thread-(b)
> investigation, (d) ran the 61-gap parity audit and opened the P5-R Notion slice
> (`3983e863-0690-81cb-b2f0-dbf5b8619711`).

## 1 · Merge the substrate (operator ruling: merge-first)

Branch `slice/p5.3e-truth-fitness` carries the WHOLE local stack: P5.3a→e (web+db) +
P5.4a→f + today's fixes. All green: web 2651+ tests / db offline suite / full gate battery
re-run at each commit. Two-PR split (db commits are few — cherry-pick them out):

```bash
# db PR (cache fix; P5.3e db GC2 fix is already on this branch too)
git checkout -b slice/p5-substrate-db main
git cherry-pick c749c40 b6c8b3f      # p5.3e-db GC2 universe fix · historic-tier cache fix
git push -u origin slice/p5-substrate-db
gh pr create --title "fix(db): P5.3e GC2 service-day universe + historic-tier cache (3600+SWR)" \
  --body "See docs/audits/p5.3-closure/gc2-deploy-runbook.md (deploy steps a/b/b'/c) and the cache rationale in b6c8b3f."

# web PR (everything else on the branch)
git checkout slice/p5.3e-truth-fitness
git push -u origin slice/p5.3e-truth-fitness
gh pr create --title "feat(web): Phase-5 substrate — P5.3a→e + P5.4a→f" \
  --body "The reviewed substrate stack (per-slice adversarial SHIPs + the 2026-07-09 re-review + P5.4f hygiene). P5-R composition redo follows as R1–R6 PRs off main — Notion slice 3983e863069081cbb2f0dbf5b8619711."
```

(If you prefer the original a→e PR ladder, the per-slice branch tips from the closure memo
still exist: `slice/p5.3a-foundation` 9f769a9 → … — but one PR is cheaper on Actions minutes
and it is all pre-reviewed.)

## 2 · Deploy the db PR + run the GC2 runbook

Follow `docs/audits/p5.3-closure/gc2-deploy-runbook.md` steps (a)→(c) verbatim after the db
PR merges. ONE addition from today: after the FIRST daily publish post-deploy, run the proxy
smoke gate — historic artifacts flip to `max-age=3600, stale-while-revalidate=86400` on their
next content rewrite (hash-guarded), and smoke.sh now accepts old|new during the rollout:

```bash
apps/data-proxy/smoke.sh
```

## 3 · Thread (b) close-out — data_health.json 404 (NO code change needed)

`status/data_health.json` publisher has been on main since S11/#194 (live-cycle lane,
`snapshots/publish.py:348`). Prod 404s because the VM's realtime **worker container predates
that merge** (same class as the 2026-06 OccupancyMix pending-worker-redeploy). Fix = rebuild
the worker on-box (COMPOSE_PROJECT_NAME=transit pinned, per the re-platform runbook):

```bash
ssh transita1
cd /opt/transit && git pull   # or your image-deploy path
cd apps/db && docker compose build worker && docker compose up -d --no-deps worker
# verify (may take one live cycle ~30s):
curl -s -o /dev/null -w '%{http_code}\n' https://transit.yesid.dev/data/v1/stm/status/data_health.json   # → 200
```

Then /status's laneStat panel (already coded, ships with the web PR) lights up.

## 4 · Already closed — no action

- **repeat-offenders by_grain**: prod publishes a populated `by_grain` since `stm@2026-07-08`;
  the local web hero renders it end-to-end (browser-verified 2026-07-09). Strike runbook gap 1.
- **P5.4f fix-list**: applied + gated on the branch (network-grid natural height, ONE
  zero-padded SEC readout, SurfaceRail closeSheet seam + test, dead scope-glyph copy keys,
  76rem→`var(--container-wide)`, DateRangePicker cross-clamp + honest comments).

## 5 · Then P5-R begins

R1 (theatre machinery + home journey) branches off main once the substrate merges.
Plan: Notion slice `3983e863-0690-81cb-b2f0-dbf5b8619711` · evidence: `docs/audits/p5-r/`.
One open pick for R1: the home THESIS line — (A) "THE NETWORK, / MEASURED HONESTLY." ·
(B) "NUMBERS THAT / DON'T LIE." · (C) "EVERY BUS, / ACCOUNTED FOR." (EN+FR pairs in the
register; the audit recommends A).
