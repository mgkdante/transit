# apps/web — Transit citizen dashboard (slice-9.2)

Public, anonymous, mobile-first STM citizen-accountability dashboard. SvelteKit 2 /
Svelte 5 (runes) deployed as a **Cloudflare Worker** (Static Assets) at
`transit.yesid.dev`, styled with the **yesid.dev** design system.

- **Package manager:** `bun` — `apps/web` is a member of the root **bun + turbo**
  workspace (the Python pipeline in `../db` is uv-managed; `../data-proxy` shares the
  root `bun.lock`). Run `bun install` once at the repo root.
- **Reads only** the versioned `/v1` R2 snapshot contract over HTTP (never the DB).

## Commands

Run at the repo root once: `bun install`. Then, from `apps/web`:

```bash
bun run tokens:build    # regenerate design tokens (src/lib/styles/tokens.css, app.css @theme region, motion/tokens.ts)
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

Brand doctrine: **orange = interactive only**; data is encoded with the SEPARATE
`color.dataviz` scale (`--dataviz-*`), never the semantic `--success`/`--destructive`/
`--accent` tokens. Solid surfaces only (no alpha on card/popover). Dark-first; light theme
also ships.
