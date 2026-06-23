// $lib/components/edge — edge-condition primitives (loading / empty / stale /
// offline / error) + the per-field honest-absence value. Import from here:
// `import { EdgeState, AbsentValue } from '$lib/components/edge'`.

export { default as EdgeState } from './EdgeState.svelte';

// AbsentValue — the per-FIELD honest-absence VISUAL primitive (calm muted
// "unknown · why"). Its business layer is the pure $lib/site/absence module.
export { default as AbsentValue } from './AbsentValue.svelte';
export type { AbsentValueProps } from './AbsentValue.svelte';
