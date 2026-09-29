# Transit dependency patches

These patches are pinned to the installed package versions. Rebase or remove each
patch when upgrading its package, then run the affected behavior tests and a frozen
Bun install to verify that the patch still applies.

- `@sveltejs%2Fkit@2.70.3.patch` consumes non-streaming page-data JSON with
  `Response.json()`, so fixed responses settle only after the body completes and
  late body failures reject. This targets the completed-body cancellation
  observed with Chromium 151's default reader. Deferred `text/sveltekit-data`
  responses retain incremental decoding. Verify with
  `apps/web/src/tests/kit-data-response.test.ts`, then check current browser
  navigation/invalidation, request outcomes and the original performance budgets.
  Remove this patch when upstream Kit provides the same fixed/deferred response
  contract; review it again whenever the pinned Kit version changes.
- `bits-ui@2.18.1.patch` retains an outside touch click that arrives before
  Bits UI's deferred dismissal check. Its callback then runs after click dispatch;
  it cannot retroactively cancel a native default action. Verify with
  `apps/web/src/lib/components/shell/dismissibleLayerTouch.svelte.test.ts` and
  the Dialog, Sheet, Popover, and Menu consumers.
- `vite@7.3.6.patch` indexes existing preload links once per synchronous helper
  call, preserving hint order and CSS loading. Verify with the preload helper
  behavior cases and a browser load comparison before accepting a version change.
