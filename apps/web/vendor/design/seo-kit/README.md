# @yesid/seo-kit

Framework-neutral SEO construction mechanics. The package builds JSON-LD nodes and their script
body, alternate-locale sitemap entries, robots.txt, the yesid share card, the favicon mark and the
standard security headers. Products own content, canonical routes, indexing policy, their CSP,
filesystem writes, rasterization and HTTP responses. The Svelte head component lives in
`@yesid/ui/head`.

## Interface

Consumers can use the root export (JSON-LD, sitemap and robots, Satori) or the subpaths. See
[`api-reports/seo-kit.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.0/api-reports/seo-kit.api.md) for exact types and exports.

- `./jsonld`: node builders and `serializeJsonLd(nodes)`, one `@graph` body with `<` escaped.
- `./sitemap`: alternate-locale entries, the sitemap document and `robotsTxt`.
- `./satori`: `renderSatoriPng` with an injected rasterizer.
- `./og`: `renderOgPng(card, fonts, rasterize)` draws the share card (eyebrow, wordmark with the
  accent dot, title, handle and location) at `OG_WIDTH` × `OG_HEIGHT` in `OG_PALETTE`, the dark
  token colors.
- `./og/fonts`: `ogFonts`, inlined by Vite, for request-time rendering.
- `./og/files`: `ogFontFiles` and `readOgFonts()` for Bun build scripts. Native Node can't load
  this package's TypeScript from `node_modules`.
- `./icons`: `brandMarkSvg(color)`, the tab-cut ring and dot, and `touchIconSvg(ground, color)`.
- `./headers`: `SECURITY_HEADERS` and `contentSecurityPolicy(directives)`. The Permissions-Policy
  denies every listed feature; a product that uses one overrides that header (Transit allows
  `geolocation=(self)` for its locate-me control).

## Invariants

- Builders return data or strings and do not read product state.
- JSON-LD context inclusion is explicit; callers own identifiers and schema composition.
- Sitemap output escapes XML, normalizes valid dates, and preserves caller-selected empty-element
  style and locale ordering. `robotsTxt` without indexing disallows everything.
- Card colors come from `tokens.json`, never literals. `fonts/` holds the card's Inter and
  JetBrains Mono TTFs; Satori can't read WOFF2.
- PNG conversion stays behind the injected rasterizer because native and file ownership varies by
  consumer.
- The package owns no routes, locale registry, cache, CSP or deployment adapter.

## Consumers and compatibility

Consumers supply content and adapters at their own framework seam. `satori` is a peer dependency
within the supported manifest range. Current adoption receipts live in
[`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.0/CONSUMERS.md); product SEO policy stays in
[`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.0/BOUNDARIES.md).

## Commands

```sh
bun run --cwd packages/seo-kit test
bun run --cwd packages/seo-kit check
```

## Failure modes and release implications

Invalid caller content remains a consumer problem. Invalid dates are omitted by the sitemap
mechanics; Satori or rasterizer failures reject to the caller. Consumers decide whether to fail a
build, retry, or provide another asset.

Builder behavior, output bytes, exports, or README changes alter the coordinated release payload.
Follow [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.0/RELEASING.md); update the API report only for public-interface
changes. Do not promote one product's route/content policy into this package.
