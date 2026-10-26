# @yesid/i18n-core

Pure locale-routing mechanics configured by the consumer. The package owns prefix parsing,
path localization/delocalization, URL-state preservation, locale-switch detection, and route-ID
normalization. Products own locale values, copy, exemptions, framework adapters, and runtime
flags.

## Interface

The root export exposes the routing configuration/types and `createLocaleRouting`. The exact
public interface is [`api-reports/i18n-core.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/api-reports/i18n-core.api.md).

## Invariants

- The default locale cannot also be a prefixed locale.
- Only rooted, non-protocol-relative hrefs are localized.
- Exempt paths pass through unchanged.
- Search/hash preservation is an explicit consumer choice.
- Locale switching compares delocalized paths and resolved locales.
- No SvelteKit virtual module, browser state, filesystem, or network dependency enters the package.

## Consumers and compatibility

Consumers create one routing closure from their locale/exemption policy, then adapt it to their
framework. Unsupported locale input falls back through consumer-defined defaults rather than
inventing package policy. Current receipts live in [`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/CONSUMERS.md).

## Commands

```sh
bun run --cwd packages/i18n-core test
bun run --cwd packages/i18n-core check
```

## Failure modes and release implications

An invalid default/prefix relationship fails at construction. Incorrect exemption, locale, or
route-segment values are consumer configuration defects; diagnose them at the adapter before
changing pure routing mechanics.

Routing behavior, types, exports, or README changes alter the coordinated release payload. Follow
[`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/RELEASING.md) and update the API report for public-interface changes.
Product locale/copy policy remains downstream per [`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/BOUNDARIES.md).
