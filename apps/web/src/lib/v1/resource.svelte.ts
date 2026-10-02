import { untrack } from 'svelte';
import { getV1Runtime } from '$lib/v1/runtime';

export interface ResourceSeed<T> {
	readonly key: unknown;
	readonly data: T | null;
}

export interface ResourceOptions<T> {
	readonly enabled?: () => boolean;
	readonly key?: () => unknown;
	readonly seed?: () => ResourceSeed<T> | undefined;
}

export interface Resource<T> {
	readonly data: T | null;
	readonly error: Error | null;
	readonly loading: boolean;
	readonly settled: boolean;
	reload(): void;
}

export function createResource<T>(
	fetcher: (signal: AbortSignal) => Promise<T>,
	options: ResourceOptions<T> = {},
): Resource<T> {
	const epoch = () => getV1Runtime().refresh.epoch;
	const keyed = options.key !== undefined;
	const unresolvedKey = Symbol('unresolved-resource-key');
	const initialKey = options.key?.() ?? unresolvedKey;
	const candidateSeed = options.seed?.();
	const initialSeed =
		candidateSeed !== undefined && (!keyed || Object.is(candidateSeed.key, initialKey))
			? candidateSeed
			: undefined;
	const initialData = initialSeed?.data ?? null;
	let data = $state<T | null>(initialData);
	let error = $state<Error | null>(null);
	let loading = $state(false);
	let settled = $state(initialSeed !== undefined);
	let stateKey = $state.raw<unknown>(initialSeed === undefined ? unresolvedKey : initialKey);
	let dataKey = $state.raw<unknown>(initialSeed === undefined ? unresolvedKey : initialKey);
	let lastSeedKey: unknown = unresolvedKey;
	let lastSeedData: T | null | typeof unresolvedKey = unresolvedKey;
	let sawSeed = false;

	let manual = $state(0);
	let seq = 0;

	const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
	const isAbortError = (e: unknown): boolean =>
		typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';

	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		manual;
		epoch();
		const activeKey = options.key?.() ?? unresolvedKey;
		const seed = options.seed?.();
		const matchingSeed = seed !== undefined && (!keyed || Object.is(seed.key, activeKey));
		const newSeed =
			matchingSeed &&
			(!sawSeed || !Object.is(seed.key, lastSeedKey) || !Object.is(seed.data, lastSeedData));

		if (newSeed) {
			seq += 1;
			stateKey = activeKey;
			dataKey = activeKey;
			if (sawSeed || !Object.is(seed.data, initialData)) data = seed.data;
			error = null;
			loading = false;
			settled = true;
			sawSeed = true;
			lastSeedKey = seed.key;
			lastSeedData = seed.data;
			return;
		}

		if (options.enabled?.() === false) {
			stateKey = activeKey;
			if (keyed && !Object.is(dataKey, activeKey)) data = null;
			loading = false;
			error = null;
			return;
		}

		const token = ++seq;
		const controller = new AbortController();
		const cleanup = () => {
			if (token === seq) seq += 1;
			controller.abort();
		};

		stateKey = activeKey;
		if (keyed && !untrack(() => Object.is(dataKey, activeKey))) {
			data = null;
			dataKey = unresolvedKey;
			settled = false;
		}
		loading = true;
		error = null;

		let pending: Promise<T>;
		try {
			pending = fetcher(controller.signal);
		} catch (e) {
			if (!isAbortError(e)) error = toError(e);
			loading = false;
			settled = true;
			return cleanup;
		}

		pending
			.then((value) => {
				if (token !== seq) return;
				data = value;
				dataKey = activeKey;
			})
			.catch((e) => {
				if (token !== seq) return;
				if (!isAbortError(e)) error = toError(e);
			})
			.finally(() => {
				if (token !== seq) return;
				loading = false;
				settled = true;
			});

		return cleanup;
	});

	return {
		get data() {
			if (keyed && !Object.is(options.key?.(), dataKey)) return null;
			return data;
		},
		get error() {
			if (keyed && !Object.is(options.key?.(), stateKey)) return null;
			return error;
		},
		get loading() {
			if (keyed && !Object.is(options.key?.(), stateKey)) return true;
			return loading;
		},
		get settled() {
			if (keyed && !Object.is(options.key?.(), stateKey)) return false;
			return settled;
		},
		reload() {
			manual += 1;
		},
	};
}
