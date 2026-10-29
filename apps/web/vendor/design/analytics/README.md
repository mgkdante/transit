# @yesid/analytics

Consent-aware analytics mechanics with consumer-owned authority. The package supplies typed
presets, consent state, policy derivation, URL/referrer sanitization, ordered pageview/event
clients, and an injected Plausible transport. It never selects a product domain, event catalogue,
storage keys, copy, or legal policy.

## Interface

The root export and `./config`, `./consent`, `./policy`, `./client`, `./plausible`, and `./vitals`
subpaths are public. See [`api-reports/analytics.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.26.0/api-reports/analytics.api.md) for the exact
interface.

## Web vitals

`./vitals` holds the beacon schema (`parseVitalsBeacon`, `parseVitalsSample` and their limits) for
the receiving endpoint, and `startVitals({ endpoint, load })` for the page. `load` returns the
`web-vitals` module (`() => import('web-vitals')`), so the package adds no dependency. The
collector starts once per page, keeps up to 12 samples, and sends one beacon when the page is
hidden, through `sendBeacon` or a keepalive `fetch`. It never throws. Products own whether it
runs and where the samples go.

## Invariants

- Consumers inject domain, allowed event names, storage keys, controls, referrer access, and
  transport loading.
- Consent and domain checks occur before transport load and again before send.
- Pageviews are ordered and deduplicated by pathname only after a successful send.
- URLs and referrers are reduced to the bounded acquisition fields the package accepts.
- Storage, browser, lazy-load, timeout, and transport failures fail closed: no analytics send and
  no false success.
- Analytics consent never grants authority for contact forms or another data flow.

## Consumers and compatibility

Products own when the client mounts, consent copy (the consent UI is `AnalyticsConsent` in
`@yesid/ui/feedback`), storage migration, runtime configuration,
and provider acceptance. The package accepts injected adapters because browser/test/runtime
implementations genuinely vary. Current receipts live in [`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.26.0/CONSUMERS.md).

## Commands

```sh
bun run --cwd packages/analytics test
bun run --cwd packages/analytics check
```

## Failure modes and release implications

Unavailable storage makes consent unavailable. A domain mismatch, denial, changed consent during
load, invalid referrer, timeout, or transport failure sends nothing. Consumers own operational
visibility for intentionally soft failures.

Behavior, privacy mechanics, exports, or README changes alter the coordinated release payload.
Use [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.26.0/RELEASING.md); public-interface changes also require an API report.
Product policy and legal conclusions remain downstream as mapped in
[`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.26.0/BOUNDARIES.md).
