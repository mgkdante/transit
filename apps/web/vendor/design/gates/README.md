# @yesid/gates

Pure, test-runner-neutral quality engines. The package detects violations; each consumer owns the
files to scan, palette, thresholds, allowlists, exclusions, expected counts, severity, and pass or
fail decision.

## Interface

The root export contains filesystem walking/comment helpers and the style, brand-hex, color-mix,
contrast, dataviz, Tailwind-variant, and SEO coverage engines. The exact public interface is
[`api-reports/gates.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/api-reports/gates.api.md).

## Invariants

- Engines accept consumer configuration and return deterministic findings.
- Style-regression scans read each source file once, preserve configured pattern/file order, and
  restore caller-owned RegExp state after matching.
- Product names, paths, colors, thresholds, and policy never enter package defaults.
- Filesystem traversal is ordered and reports useful relative path/line diagnostics.
- Gate engines do not depend on Vitest or another runner.
- Neutral fixtures protect portable behavior; consumer-named permanent fixtures are rejected.

## Consumers and compatibility

Gallery dogfoods the engines with Gallery-owned policy. Transit and yesid.dev keep their own gate
adapters and acceptance criteria. A package pass does not prove a product policy is correct. See
[`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/BOUNDARIES.md) and the current receipts in
[`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/CONSUMERS.md).

## Commands

```sh
bun run --cwd packages/gates test
bun run --cwd packages/gates check
```

## Failure modes and release implications

A zero-file scan usually means the consumer supplied the wrong root or extensions. Invalid
patterns/configuration must fail clearly; an engine finding is data until the consumer applies its
policy. Do not hide a real violation by broadening package defaults.

Engine behavior, diagnostics, exports, or README changes alter the coordinated release payload.
Use [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.3/RELEASING.md) and regenerate the API report for public-interface
changes. Consumer-only policy changes stay in the consumer.
