# Transit dependency patches

These patches are pinned to the installed package versions. Rebase or remove each
patch when upgrading its package, then run the affected behavior tests and a frozen
Bun install to verify that the patch still applies.

- `bits-ui@2.18.1.patch` retains an outside touch click that arrives before
  Bits UI's deferred dismissal check. Its callback then runs after click dispatch;
  it cannot retroactively cancel a native default action. Verify with
  `apps/web/src/lib/components/shell/dismissibleLayerTouch.svelte.test.ts` and
  the Dialog, Sheet, Popover, and Menu consumers.
- `vite@7.3.6.patch` indexes existing preload links once per synchronous helper
  call, preserving hint order and CSS loading. Verify with the preload helper
  behavior cases and a browser load comparison before accepting a version change.
