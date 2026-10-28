# @yesid/gates

Pure, test-runner-neutral quality engines. The package detects violations; each consumer owns the
files to scan, palette, thresholds, allowlists, exclusions, expected counts, severity, and pass or
fail decision.

## Interface

The root export contains filesystem walking/comment helpers and the style, brand-hex, color-mix,
contrast, dataviz, Tailwind-variant, and SEO coverage engines. The exact public interface is
[`api-reports/gates.api.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.20.0/api-reports/gates.api.md).

## Invariants

- Engines accept consumer configuration and return deterministic findings.
- Style-regression scans read each source file once, preserve configured pattern/file order, and
  restore caller-owned RegExp state after matching.
- Comment stripping advances once through at most 1,048,576 UTF-16 code units, preserves every
  newline, and leaves incomplete delimiters visible so they cannot hide later source.
- Filesystem walks reject symbolic links and non-regular entries, enforce canonical-root
  containment, sort paths, and stop beyond 16 levels, 8,192 entries, 4,096 files, or 32 MiB in
  aggregate. Every regular file counts toward the budgets, including excluded extensions.
- Product names, paths, colors, thresholds, and policy never enter package defaults.
- Filesystem traversal is ordered and reports useful relative path/line diagnostics.
- Gate engines do not depend on Vitest or another runner.
- Neutral fixtures protect portable behavior; consumer-named permanent fixtures are rejected.

### Budget derivation

The fixed ceilings use exact public consumer snapshots and count every Git tree entry and regular
file under `apps/web/src`, including extensions the gates do not read. Eligible-source size covers
`.svelte`, `.ts`, and `.css` blobs.

| Consumer revision | Depth | Entries | Files | Aggregate bytes | Largest eligible source |
|---|---:|---:|---:|---:|---:|
| Transit `a8db58d25e8ff041e0aee765172b8feeeafca35f` | 6 | 1,207 | 1,073 | 7,229,091 | 123,554 bytes |
| yesid.dev `dab71703214ea6392064edadeca9467dcd3f0f24` | 4 | 675 | 587 | 4,352,658 | 164,489 bytes |

The traversal limits retain at least 2.6x headroom on every dimension. A valid UTF-8 file's byte
count is a conservative upper bound on its decoded UTF-16 code-unit length, so the comment ceiling
retains more than 6x headroom over the largest eligible source. Reproduce the receipt with `gh` and
`jq`:

```sh
for target in \
  "mgkdante/transit:a8db58d25e8ff041e0aee765172b8feeeafca35f" \
  "mgkdante/yesid.dev:dab71703214ea6392064edadeca9467dcd3f0f24"
do
  repository="${target%%:*}"
  revision="${target#*:}"
  gh api "repos/${repository}/git/trees/${revision}?recursive=1" --jq '
    [.tree[] | select(.path | startswith("apps/web/src/"))] as $entries
    | ($entries | map(select(.type == "blob"))) as $files
    | ($files | map(select(.path | test("\\.(svelte|ts|css)$")))) as $eligible
    | {revision: "'"$revision"'", entries: ($entries | length), files: ($files | length),
       bytes: ($files | map(.size // 0) | add // 0),
       depth: ($entries | map(.path | sub("^apps/web/src/"; "") | split("/") | length - 1) | max),
       largestEligibleBytes: ($eligible | map(.size // 0) | max)}'
done
```

## Consumers and compatibility

Gallery dogfoods the engines with Gallery-owned policy. Transit and yesid.dev keep their own gate
adapters and acceptance criteria. A package pass does not prove a product policy is correct. See
[`BOUNDARIES.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.20.0/BOUNDARIES.md) and the current receipts in
[`CONSUMERS.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.20.0/CONSUMERS.md).

## Commands

```sh
bun run --cwd packages/gates test
bun run --cwd packages/gates check
```

## Failure modes and release implications

A zero-file scan usually means the consumer supplied the wrong root or extensions. Invalid
patterns/configuration must fail clearly; an engine finding is data until the consumer applies its
policy. Scans require a stable tree: traversal rejects links and observed identity changes, but
returned paths are not descriptor-bound against a concurrent filesystem rewrite before a caller
reads them. Do not hide a real violation by broadening package defaults.

Engine behavior, diagnostics, exports, or README changes alter the coordinated release payload.
Use [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.20.0/RELEASING.md) and regenerate the API report for public-interface
changes. Consumer-only policy changes stay in the consumer.
