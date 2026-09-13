# apps/web — Transit citizen dashboard

Public, anonymous, mobile-first STM citizen-accountability dashboard. SvelteKit 2 /
Svelte 5 (runes) deployed as a **Cloudflare Worker** (Static Assets) at
`transit.yesid.dev`, styled with the **yesid.dev** design system.

- **Toolchain:** the root `.nvmrc`, `.bun-version`, and `package.json` own Node
  22.23.2, Bun 1.3.11, and Wrangler 4.115.0. `apps/web` is a member of the root **bun +
  turbo** workspace (the Python pipeline in `../db` is uv-managed;
  `../data-proxy` shares the root `bun.lock`). Run `bun install --frozen-lockfile`
  once at the repo root.
- **Reads only** the versioned `/v1` R2 snapshot contract (direct R2 custom
  domain in browsers, direct bucket binding in SSR; never the DB).

The root overrides pin one Vite 7.3.6 resolution for the app, Kit and Vitest.
The cookie 0.7.2 override fixes the version requested by Kit while preserving
its API/types; it also applies to Youch because Bun 1.3.11 supports only top-level
overrides. Both consumers are checked in `src/tests/dependencyCookies.test.ts`.
Revisit this cross-range override when Kit accepts a patched version or the
approved Bun version supports narrower rules. After dependency changes, verify
the installed graph as well as the lockfile and run `bun audit`.

## Snapshot ownership

`src/lib/v1/adapter` owns snapshot discovery, caching, and schema validation.
Its port types follow the implemented methods; `AdapterCtx` carries request
context. `http.ts` accepts `FetchFn`, and `binding.ts` supplies bucket and service
fetch adapters. This is the transport seam used by browsers, SSR, and tests.
Tier repositories own one-shot reads; `src/lib/v1/live/store.svelte.ts` owns
reactive live polling.
The `v1` entry point exposes shared contracts, context, and computations. Import
runtime reads from their owning repository so network boundaries stay visible.

For a component that reads one live family, `live/resource.ts` pairs its store
with a `ResourceBoundary` view and owns mount/unmount polling. Trip and stop
details use this shared path. Use the live store directly for multiple families
or subscriptions; its clock, retention and pause/resume policies remain shared.

`PUBLIC_V1_BASE` and `PUBLIC_V1_PROVIDER` select the snapshot base and provider at
runtime, defaulting to `/data/v1` and `stm`. Manifest pointers include their tier;
URL construction belongs to `src/lib/v1/config.ts`.

Service-count cards share bilingual wording in
`src/lib/v1/serviceComparison.ts`. They compare reported and
scheduled counts without matching trip identities. The public field names remain
compatible; their [definitions](../db/README.md#service-counts) belong to the
pipeline. Live fleet coverage has a separate known-status denominator.

## Page metadata

`src/lib/seo/routeSeo.ts` owns bilingual route descriptions and section-level
detail fallbacks. Describe the page's actual data, coverage and time window;
use concise copy without padding to a minimum length. `SeoHead` emits the same
description for document, Open Graph and Twitter metadata. Its development
warnings flag blank descriptions and suggest shortening copy above 160 characters.
Default social cards come from `scripts/build-og.ts`; they describe the product,
not its current operating status. Regenerate both cards after changing that copy.

## Commands

Use the Node version in the root `.nvmrc` (`nvm install` if you use NVM), then run
`bun install --frozen-lockfile` at the repository root. From `apps/web`:

```bash
bun run tokens:build
bun run dev
bun run check
bun run build
bun run test
bun run og:build
```

`bun run test` is Vitest. Browser-level receipt and probe scripts under `scripts/`
launch Chromium through `playwright-core` directly; there is no `@playwright/test`
suite or config. On Linux x64, set
`TRANSIT_BROWSER_ROOT="$(mktemp -d)"`, export it, run
`node scripts/install-browser-toolchain.mjs "$TRANSIT_BROWSER_ROOT"`, then run
`node scripts/verify-browser-toolchain.mjs`. The installer checks the exact
archive and executable SHA-256 values in `browser-toolchain.json` before any
browser starts; the verifier also reconciles Playwright metadata and the
checked-in map-poster receipt.

Keep `TRANSIT_BROWSER_ROOT` set to the directory passed to the installer. The
printed executable is nested beneath it. If deployment `PUBLIC_*` variables are
set in your shell, run unit tests with the isolated command in
[CONTRIBUTING.md](../../CONTRIBUTING.md#verification).

Or from the repo root via turbo: `turbo run check`, `turbo run build`, `turbo run test`
(spans the whole workspace). Deploy: `bun run deploy:web` (root) — `bun run build`
then the root-installed Wrangler (the `transit.yesid.dev/data/*` route stays on the
data-proxy worker by route specificity).

## Design tokens

Live vehicle and trip status comes from the publisher's raw-second calculation.
Use the status helpers in `src/lib/site/delayPresentation.ts` for its color and
band; rounded `delay_min` cannot reconstruct that status. A 30-second delay can
display as one minute while remaining in the on-time band. Unknown status uses
the neutral status color and never supplies a missing delay. Stop predictions
retain their separate minute-based presentation. Keep the measured value,
published classification, and absence state distinct.

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

Use the tool from the immutable Release archive as an external bootstrap for a deliberate
bump, then run the adopted tool only as the offline integrity gate:

```bash
design_tag=vX.Y.Z
bootstrap_root="$(mktemp -d)"
archive_name="yesid.dev-design-${design_tag}.tar"
gh release download "$design_tag" --repo mgkdante/yesid.dev-design \
  --pattern "$archive_name" --dir "$bootstrap_root"
mkdir "$bootstrap_root/extracted"
tar -xf "$bootstrap_root/$archive_name" -C "$bootstrap_root/extracted"
bun "$bootstrap_root/extracted/yesid.dev-design-${design_tag}/tools/adopt.ts" \
  --tag "$design_tag" \
  --packages tokens,motion,gates,seo-kit,ui,analytics,i18n-core \
  --dest vendor/design
bun vendor/design/tools/adopt.ts --check --dest vendor/design
```

Run this from `apps/web`, review the complete vendored diff, update the exact pin in
`src/tests/design-vendor.test.ts`, refresh the root lockfile, and run product checks. Package
tests stay upstream; Transit owns its doctrine, integration, type, build, and browser proof.
The product-owned `src/lib/analytics/preset.ts` is configuration only; adopting the package
does not mount analytics or grant storage or network authority.
