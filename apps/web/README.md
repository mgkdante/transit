# apps/web — Transit citizen dashboard

Public, anonymous, mobile-first STM citizen-accountability dashboard. SvelteKit 2 /
Svelte 5 (runes) deployed as a **Cloudflare Worker** (Static Assets) at
`transit.yesid.dev`, styled with the **yesid.dev** design system.

- **Package manager:** `bun` — `apps/web` is a member of the root **bun + turbo**
  workspace (the Python pipeline in `../db` is uv-managed; `../data-proxy` shares the
  root `bun.lock`). Run `bun install` once at the repo root.
- **Reads only** the versioned `/v1` R2 snapshot contract (direct R2 custom
  domain in browsers, direct bucket binding in SSR; never the DB).

## Commands

Run at the repo root once: `bun install`. Then, from `apps/web`:

```bash
bun run tokens:build    # regenerate Transit CSS tokens (src/lib/styles/tokens.css, app.css @theme region)
bun run dev             # dev server
bun run check           # svelte-check
bun run build           # production build (adapter-cloudflare → .svelte-kit/cloudflare, workers mode)
bun run test            # vitest (data + dom projects)
bun run og:build        # regenerate Open Graph cards (scripts/build-og.ts)
```

Or from the repo root via turbo: `turbo run check`, `turbo run build`, `turbo run test`
(spans the whole workspace). Deploy: `bun run deploy:web` (root) — `bun run build` then
`wrangler deploy` (the `transit.yesid.dev/data/*` route stays on the data-proxy worker
by route specificity).

## Design tokens

Source of truth: `tools/tokens/tokens.json` (DTCG). Generators run under `bun`
(`bun tools/tokens/build.ts`) and emit checked-in artifacts; CI runs
`bun run tokens:build && git diff --exit-code` so a stale or hand-edited generated file
fails the build. Edit `tokens.json`, run `bun run tokens:build`, commit the result.
Everything in `app.css` OUTSIDE the `TOKENS:START/END` sentinel region is hand-maintained.
JavaScript motion tokens come from the immutable `@yesid/motion` customer snapshot.

Brand doctrine: **orange = interactive only**; data is encoded with the SEPARATE
`color.dataviz` scale (`--dataviz-*`), never the semantic `--success`/`--destructive`/
`--accent` tokens. Solid surfaces only (no alpha on card/popover). Dark-first; light theme
also ships.

## Design-system adoption

`vendor/design` is a customer snapshot of one immutable `yesid.dev-design` Release. Its
schema-2 manifest pins the Release asset, annotated tag object, peeled commit, package
closure, adoption tool, exclusion policy, and installed tree. Never edit it by hand or run
the tool from inside `vendor/design` while replacing that same directory.

Use an external exact-tag bootstrap for a deliberate bump, then run the adopted tool only
as the offline integrity gate:

```bash
design_tag=vX.Y.Z
bootstrap_root="$(mktemp -d)"
git clone --depth 1 --branch "$design_tag" \
  https://github.com/mgkdante/yesid.dev-design "$bootstrap_root/yesid.dev-design"
bun "$bootstrap_root/yesid.dev-design/tools/adopt.ts" \
  --tag "$design_tag" \
  --packages tokens,motion,gates,ui \
  --dest vendor/design
bun vendor/design/tools/adopt.ts --check --dest vendor/design
```

Run this from `apps/web`, review the complete vendored diff, update the exact pin in
`src/tests/design-vendor.test.ts`, refresh the root lockfile, and run product checks. Package
tests stay upstream; Transit owns its doctrine, integration, type, build, and browser proof.
