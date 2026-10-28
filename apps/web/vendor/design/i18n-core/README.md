# @yesid/i18n-core

Framework-free locale mechanics configured by the consumer: routing (prefix parsing, path
localization/delocalization, URL-state preservation, locale-switch detection, route-ID
normalization), Intl formatting and relative time, and typed copy. Products own locale values,
Intl tags, copy, exemptions, framework adapters, and runtime flags.

## Interface

The root export exposes `createLocaleRouting`, `createIntl` and `createCopy` with their types.
Each app binds them once to its own locales:

```ts
export const intl = createIntl<Locale>({ en: 'en-CA', fr: 'fr-CA' });
export const defineCopy = createCopy<Locale, 'fr'>();

intl.number(locale, { maximumFractionDigits: 1 }).format(value);
intl.dateTime(locale, { dateStyle: 'medium' }).format(date);
intl.relativeTime(locale, -180); // "3 minutes ago", "il y a 3 minutes"
```

`number`, `dateTime`, `collator` and `plural` return Intl objects cached per locale and options, so a
component can ask for one on every render. `relativeTime` takes a signed offset in seconds
(negative is past), picks the largest whole unit, and reads anything under 5 seconds as Intl's own
"now". `defineCopy` returns its argument unchanged; at compile time every locale must have the
source locale's keys and function signatures.

The SvelteKit param matcher is `routing.isPrefixLocale`: `export const match = routing.isPrefixLocale`
in Kit 2, `locale: (param) => (routing.isPrefixLocale(param) ? param : undefined)` in Kit 3's
`defineParams`. Kit 3 imports `src/params.ts` natively with Node at build time, so that file must
not import this TypeScript package; keep its prefix list in a dependency-free module.

Locale context and `<html lang>` live in `@yesid/ui` (`createLocaleContext` and `SiteRoot`'s
`lang`), because they need Svelte. The exact public interface is [`api-reports/i18n-core.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.2/api-reports/i18n-core.api.md).

## Invariants

- The default locale cannot also be a prefixed locale.
- Only rooted, non-protocol-relative hrefs are localized.
- Exempt paths pass through unchanged.
- Search/hash preservation is an explicit consumer choice.
- Locale switching compares delocalized paths and resolved locales.
- `relativeTime` throws a RangeError for a non-finite offset, as Intl does.
- No framework, SvelteKit virtual module, browser state, filesystem, or network dependency enters
  the package.

## Consumers and compatibility

Consumers create one routing closure from their locale/exemption policy, then adapt it to their
framework. Unsupported locale input falls back through consumer-defined defaults rather than
inventing package policy. Current receipts live in [`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.2/CONSUMERS.md).

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
[`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.2/RELEASING.md) and update the API report for public-interface changes.
Product locale/copy policy remains downstream per [`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.25.2/BOUNDARIES.md).
