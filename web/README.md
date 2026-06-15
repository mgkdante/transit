# web/ — Transit citizen dashboard (slice-9.2)

Public, anonymous, mobile-first STM citizen-accountability dashboard. SvelteKit 2 /
Svelte 5 (runes) on **Cloudflare Pages**, styled with the **yesid.dev** design system.

- **Package manager:** `pnpm` (the Python pipeline in `../db` uses `uv`). `web/` is a
  **standalone** app — NOT a bun/pnpm workspace member; no `@repo/shared`.
- **Reads only** the versioned `/v1` R2 snapshot contract over HTTP (never the DB).

## Commands

```bash
pnpm install         # deps
pnpm tokens:build    # regenerate design tokens (src/lib/styles/tokens.css, app.css @theme region, motion/tokens.ts)
pnpm dev             # dev server
pnpm check           # svelte-check
pnpm build           # production build (adapter-cloudflare → .svelte-kit/cloudflare)
pnpm test            # vitest (data + dom projects)
```

## Design tokens

Source of truth: `tools/tokens/tokens.json` (DTCG). Generators (ported off bun → `tsx`)
emit checked-in artifacts; CI runs `pnpm tokens:build && git diff --exit-code` so a stale
or hand-edited generated file fails the build. Edit `tokens.json`, run `pnpm tokens:build`,
commit the result. Everything in `app.css` OUTSIDE the `TOKENS:START/END` sentinel region
is hand-maintained.

Brand doctrine: **orange = interactive only**; data is encoded with the SEPARATE
`color.dataviz` scale (`--dataviz-*`), never the semantic `--success`/`--destructive`/
`--accent` tokens. Solid surfaces only (no alpha on card/popover). Dark-first; light theme
also ships.
