import type { Resource } from './resource.svelte';
import type { AbsenceReason } from '$lib/site/serviceWindow';

export type { AbsenceReason };

export type DataState<T> =
	| { kind: 'ok'; data: NonNullable<T> }
	| { kind: 'loading' }
	| { kind: 'empty'; reason: AbsenceReason | null }
	| { kind: 'no_results' }
	| { kind: 'error'; staleAt?: string };

export interface ResolveOptions<T> {
	isEmpty?: (data: NonNullable<T>) => boolean;
	isNoResults?: (data: NonNullable<T>) => boolean;
	emptyReason?: AbsenceReason | null;
	staleAt?: string;
}

export function asDataState<T>(resource: Resource<T>, opts: ResolveOptions<T> = {}): DataState<T> {
	const value = resource.data;
	if (value != null) {
		const present = value as NonNullable<T>;
		if (opts.isNoResults?.(present)) return { kind: 'no_results' };
		if (opts.isEmpty?.(present)) return { kind: 'empty', reason: opts.emptyReason ?? null };
		return { kind: 'ok', data: present };
	}
	if (resource.error) return { kind: 'error', staleAt: opts.staleAt };
	if (resource.loading || !resource.settled) return { kind: 'loading' };
	return { kind: 'empty', reason: opts.emptyReason ?? null };
}
