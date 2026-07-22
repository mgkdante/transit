import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineHistoryResource } from '$lib/features/lines/reliability/data/lineHistoryResource.svelte';
import type { NetworkHistoryResource } from '$lib/features/network/reliability/data/networkHistoryResource.svelte';
import type { StopHistoryResource } from '$lib/features/stops/reliability/data/stopHistoryResource.svelte';
import type { RawHistoryRangeRequest } from './rangeResource.svelte';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type _LineSignature = Expect<
	Equal<
		typeof import('$lib/features/lines/reliability/data/lineHistoryResource.svelte').createLineHistoryResource,
		(entityId: string, request: RawHistoryRangeRequest) => LineHistoryResource
	>
>;
type _NetworkSignature = Expect<
	Equal<
		typeof import('$lib/features/network/reliability/data/networkHistoryResource.svelte').createNetworkHistoryResource,
		(request: RawHistoryRangeRequest) => NetworkHistoryResource
	>
>;
type _StopSignature = Expect<
	Equal<
		typeof import('$lib/features/stops/reliability/data/stopHistoryResource.svelte').createStopHistoryResource,
		(entityId: string, request: RawHistoryRangeRequest) => StopHistoryResource
	>
>;

const wrappers = [
	{
		name: 'createStopHistoryResource',
		path: 'src/lib/features/stops/reliability/data/stopHistoryResource.svelte.ts',
		error: 'stop history range requires a resolved selection',
	},
	{
		name: 'createLineHistoryResource',
		path: 'src/lib/features/lines/reliability/data/lineHistoryResource.svelte.ts',
		error: 'line history range requires a resolved selection',
	},
	{
		name: 'createNetworkHistoryResource',
		path: 'src/lib/features/network/reliability/data/networkHistoryResource.svelte.ts',
		error: 'network history range requires a resolved selection',
	},
] as const;

describe('retained-history resource factory contract', () => {
	it.each(wrappers)('$name delegates to the one shared factory', ({ path, error }) => {
		const source = readFileSync(resolve(process.cwd(), path), 'utf8');

		expect(source).toContain('createRetainedHistoryResource');
		expect(source).not.toContain('createHistoryRangeResource');
		expect(source).toContain(`missingSelectionError: '${error}'`);
	});

	it('preserves the three public factory names and signatures', () => {
		for (const { name, path } of wrappers) {
			const source = readFileSync(resolve(process.cwd(), path), 'utf8');
			expect(source).toContain(`export function ${name}(`);
		}
	});
});
