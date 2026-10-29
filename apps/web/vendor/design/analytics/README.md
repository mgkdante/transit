# @yesid/analytics

Cookieless Plausible measurement and web-vitals collection. `createAnalytics` wraps the official
[`@plausible-analytics/tracker`](https://www.npmjs.com/package/@plausible-analytics/tracker):
it captures pageviews, including client-side navigation, and returns a `trackEvent` typed to the
product's events. The package never selects a product domain, event names, copy, or privacy policy.

## Interface

The root export and `./config`, `./client`, and `./vitals` subpaths are public.
See [`api-reports/analytics.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.27.0/api-reports/analytics.api.md)
for the exact interface.

## Measurement

In the root layout:

```ts
import { createAnalytics, defineAnalyticsPreset } from '@yesid/analytics';
const preset = defineAnalyticsPreset({ events: ['signup_click'] });
onMount(() => {
	const analytics = createAnalytics(preset, { domain: PUBLIC_PLAUSIBLE_DOMAIN });
	analytics.trackEvent('signup_click');
});
```

It sends nothing unless `domain` is set and the page is served from that host or a subdomain,
so local, preview and fork deployments stay silent. Call it once per page load in the browser
(it throws if the tracker is started twice). Each request carries only the page path, bounded
campaign tags (`utm_*`, `ref`, `source`) and the referrer's origin. Nothing is written to cookies
or browser storage. The product's CSP needs `connect-src https://plausible.io`.

## Web vitals

`./vitals` holds the beacon schema (`parseVitalsBeacon`, `parseVitalsSample` and their limits) for
the receiving endpoint, and `startVitals({ endpoint, load })` for the page. `load` returns the
`web-vitals` module (`() => import('web-vitals')`), so the package adds no dependency. The
collector starts once per page, keeps up to 12 samples, and sends one beacon when the page is
hidden, through `sendBeacon` or a keepalive `fetch`. It never throws. Products own whether it
runs and where the samples go.

## Invariants

- Products supply the domain and event vocabulary.
- No domain, a foreign host or no browser location sends nothing and never starts the tracker.
- URLs and referrers are reduced before they leave the browser.
- No cookies or storage writes; the tracker only reads its own `plausible_ignore` opt-out.
- Only pageviews, engagement and the preset's custom events are sent, never custom properties or revenue.
- A URL that cannot be reduced drops the event instead of throwing into navigation.

## Consumers and compatibility

Products own the domain, when measurement starts, the event vocabulary, the privacy policy and
the CSP. Current receipts live in [`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.27.0/CONSUMERS.md).

## Commands

```sh
bun run --cwd packages/analytics test
bun run --cwd packages/analytics check
```

## Failure modes and release implications

An unset domain, a foreign host or a server render sends nothing. Delivery is fire-and-forget;
products own any operational visibility.

Behavior, privacy mechanics, exports, or README changes alter the coordinated release payload.
Use [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.27.0/RELEASING.md); public-interface changes also require an API report.
Product policy and legal conclusions remain downstream as mapped in
[`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.27.0/BOUNDARIES.md).
