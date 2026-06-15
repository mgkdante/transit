// $lib/components/shell — the responsive app-shell chrome.
//
// The shell is the persistent application frame: a TopBar over a responsive
// 3-zone body (desktop LeftRail + MapStage + RightPanel; mobile full-bleed map
// + BottomSheet). Pages compose it via named snippet props (rail / main /
// detail / detailFooter) and drive it with bindable `search` + `detailOpen`.
//
// Import the composed shell from here:
//   import { AppShell } from '$lib/components/shell';
// The individual zones are exported too for pages that assemble a custom frame.

export { default as AppShell } from './AppShell.svelte';
export { default as TopBar } from './TopBar.svelte';
export { default as LeftRail } from './LeftRail.svelte';
export { default as RightPanel } from './RightPanel.svelte';
export { default as BottomSheet } from './BottomSheet.svelte';
