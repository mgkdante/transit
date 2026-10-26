# @yesid/analytics

Consent-aware analytics mechanics with consumer-owned authority. The package supplies typed
presets, consent state, policy derivation, URL/referrer sanitization, ordered pageview/event
clients, and an injected Plausible transport. It never selects a product domain, event catalogue,
storage keys, copy, or legal policy.

## Interface

The root export and `./config`, `./consent`, `./policy`, `./client`, and `./plausible` subpaths are
public. See [`api-reports/analytics.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/api-reports/analytics.api.md) for the exact
interface.

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

Products own when the client mounts, consent copy/UI, storage migration, runtime configuration,
and provider acceptance. The package accepts injected adapters because browser/test/runtime
implementations genuinely vary. Current receipts live in [`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/CONSUMERS.md).

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
Use [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/RELEASING.md); public-interface changes also require an API report.
Product policy and legal conclusions remain downstream as mapped in
[`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/BOUNDARIES.md).
