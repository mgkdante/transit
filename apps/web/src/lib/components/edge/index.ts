// $lib/components/edge — edge-condition primitives (loading / empty / stale /
// offline / error) + the per-field honest-absence value. Import from here:
// `import { EdgeState, AbsentValue } from '$lib/components/edge'`.

export { default as EdgeState } from './EdgeState.svelte';

// AbsentValue — the per-FIELD honest-absence VISUAL primitive (calm muted
// "unknown · why"). Its business layer is the pure $lib/site/absence module.
export { default as AbsentValue } from './AbsentValue.svelte';
export type { AbsentValueProps } from './AbsentValue.svelte';

// MaybeValue — the inline value-or-absence primitive: render the value, else the
// AbsentValue chip. The free-standing-cell sibling of MetricDisplay (tiles) and
// RankedRow (rows), so no surface hand-rolls a {#if}{:else}<AbsentValue/> branch.
export { default as MaybeValue } from './MaybeValue.svelte';
export type { MaybeValueProps } from './MaybeValue.svelte';
