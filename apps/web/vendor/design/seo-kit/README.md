# @yesid/seo-kit

Framework-neutral SEO construction mechanics. The package builds JSON-LD nodes, alternate-locale
sitemap entries, and Satori SVG with consumer-injected rasterization. Products own content,
canonical routes, indexing policy, fonts, templates, filesystem writes, and HTTP responses.

## Interface

Consumers can use the root export or the `./jsonld`, `./sitemap`, and `./satori` subpaths. See
[`api-reports/seo-kit.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/api-reports/seo-kit.api.md) for exact types and exports.

## Invariants

- Builders return data or strings and do not read product state.
- JSON-LD context inclusion is explicit; callers own identifiers and schema composition.
- Sitemap output escapes XML, normalizes valid dates, and preserves caller-selected empty-element
  style and locale ordering.
- Satori rendering accepts caller options; PNG conversion stays behind the injected rasterizer
  seam because file/native/network ownership varies by consumer.
- The package owns no routes, locale registry, font files, cache, or deployment adapter.

## Consumers and compatibility

Consumers supply content and adapters at their own framework seam. `satori` is a peer dependency
within the supported manifest range. Current adoption receipts live in
[`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/CONSUMERS.md); product SEO policy stays in
[`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/BOUNDARIES.md).

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
Follow [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/RELEASING.md); update the API report only for public-interface
changes. Do not promote one product's route/content policy into this package.
