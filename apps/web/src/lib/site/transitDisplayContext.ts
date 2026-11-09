import { getContext } from 'svelte';
import type { V1Context } from '#lib/v1/boot.ts';
import { lineLabel } from './transitDisplay';

/** Optional so reusable detail rows can also render outside a booted page. */
export function transitDisplay() {
	const reader = getContext<(() => V1Context | undefined) | undefined>(
		Symbol.for('transit.v1.context'),
	);
	return { line: (id: string) => lineLabel(id, [], reader?.()?.manifest.provider) };
}
