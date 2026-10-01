import type {
	ReliabilityLoader,
	ReliabilitySnapshot,
	ReliabilityTarget,
} from '$lib/v1/reliabilitySnapshot.svelte';

export function isReliabilitySnapshotPending(snapshot: ReliabilitySnapshot): boolean {
	return snapshot.phase === 'idle' || snapshot.phase === 'loading';
}

interface ReliabilityListingOptions<T> {
	readonly loader: ReliabilityLoader;
	readonly candidates: () => readonly T[];
	readonly id: (candidate: T) => string;
	readonly target?: (candidate: T) => ReliabilityTarget;
	readonly requestWhen: () => boolean;
	readonly rankWhen: () => boolean;
	readonly rank: (snapshot: ReliabilitySnapshot) => number;
}

export interface ReliabilityListingController<T> {
	readonly coveragePending: boolean;
	readonly rankingPending: boolean;
	order(items: readonly T[]): readonly T[];
}

export function createReliabilityListingController<T>(
	options: ReliabilityListingOptions<T>,
): ReliabilityListingController<T> {
	const candidates = $derived.by(() => options.candidates());
	const candidateKey = $derived(JSON.stringify(candidates.map(options.id)));
	const requestEnabled = $derived(options.requestWhen());
	const rankingEnabled = $derived(options.rankWhen());
	const hasPending = $derived.by(() =>
		candidates.some((candidate) =>
			isReliabilitySnapshotPending(options.loader.get(options.id(candidate))),
		),
	);

	let committedKey = $state<string | null>(null);
	let committedOrder = $state<readonly string[] | null>(null);

	$effect(() => {
		if (!requestEnabled) return;
		for (const candidate of candidates) {
			options.loader.request(options.target?.(candidate) ?? options.id(candidate));
		}
	});

	$effect(() => {
		if (!rankingEnabled) {
			committedKey = null;
			committedOrder = null;
			return;
		}

		const key = candidateKey;
		const current = candidates;
		if (hasPending) {
			committedKey = null;
			committedOrder = null;
			return;
		}
		if (committedKey === key && committedOrder != null) return;

		committedOrder = current
			.map((candidate, sourceIndex) => ({
				id: options.id(candidate),
				rank: options.rank(options.loader.get(options.id(candidate))),
				sourceIndex,
			}))
			.sort((a, b) => a.rank - b.rank || a.sourceIndex - b.sourceIndex)
			.map(({ id }) => id);
		committedKey = key;
	});

	return {
		get coveragePending() {
			return requestEnabled && hasPending;
		},
		get rankingPending() {
			return rankingEnabled && hasPending;
		},
		order(items) {
			if (!rankingEnabled || committedKey !== candidateKey || committedOrder == null) return items;
			return items
				.map((candidate, sourceIndex) => {
					const frozenIndex = committedOrder?.indexOf(options.id(candidate)) ?? -1;
					return {
						candidate,
						sourceIndex,
						frozenIndex: frozenIndex < 0 ? Number.MAX_SAFE_INTEGER : frozenIndex,
					};
				})
				.sort((a, b) => a.frozenIndex - b.frozenIndex || a.sourceIndex - b.sourceIndex)
				.map(({ candidate }) => candidate);
		},
	};
}
