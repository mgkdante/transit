// $lib/components/shell — the responsive app-shell chrome.
//
// AppShell owns the persistent NavPill and caller-provided main surface.
// Feature owners compose the exported detail surfaces when a selection opens.
//
// Import the composed shell from here:
//   import { AppShell } from '$lib/components/shell';
// The individual zones are exported too for pages that assemble a custom frame.

export { default as AppShell } from './AppShell.svelte';
export { default as NavPill } from './NavPill.svelte';
export { default as RightPanel } from './RightPanel.svelte';
export { default as BottomSheet } from './BottomSheet.svelte';

// Reusable chrome controls (composed by NavPill; reusable in footer / menu).
export { default as BrandWordmark } from './BrandWordmark.svelte';
export { default as BrandCluster } from '$lib/components/brand/BrandCluster.svelte';
export { default as RefreshButton } from './RefreshButton.svelte';
export { default as ThemeToggle } from './ThemeToggle.svelte';
export { default as LangSwitch } from './LangSwitch.svelte';
