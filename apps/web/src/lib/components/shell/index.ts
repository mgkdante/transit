// $lib/components/shell — the responsive app-shell chrome.
//
// The shell is the persistent application frame: a floating NavPill (which carries
// ALL site nav — Map/Lines/Stops/Network + Audit via the hamburger) over a
// full-bleed MapStage + a RightPanel (desktop) / BottomSheet (mobile) detail
// surface. Pages compose it via named snippet props (main / detail / detailFooter)
// and drive it with bindable `search` + `detailOpen`.
//
// Import the composed shell from here:
//   import { AppShell } from '$lib/components/shell';
// The individual zones are exported too for pages that assemble a custom frame.

export { default as AppShell } from './AppShell.svelte';
export { default as NavPill } from './NavPill.svelte';
export { default as RightPanel } from './RightPanel.svelte';
export { default as BottomSheet } from './BottomSheet.svelte';

// Reusable chrome controls (composed by TopBar; reusable in footer / menu).
export { default as BrandWordmark } from './BrandWordmark.svelte';
export { default as BrandCluster } from '$lib/components/brand/BrandCluster.svelte';
export { default as SurfaceNavList } from './SurfaceNavList.svelte';
export { default as LiveClock } from './LiveClock.svelte';
export { default as RefreshButton } from './RefreshButton.svelte';
export { default as ThemeToggle } from './ThemeToggle.svelte';
export { default as LangSwitch } from './LangSwitch.svelte';
