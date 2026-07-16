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
	/** Any eligible candidate is still idle or loading while full coverage is requested. */
	readonly coveragePending: boolean;
	/** Ranking is active and still waiting for at least one terminal snapshot. */
	readonly rankingPending: boolean;
	/**
	 * Keep the supplied source order until every candidate is terminal, then apply
	 * the one frozen ranking committed for the current candidate set.
	 */
	order(items: readonly T[]): readonly T[];
}

/**
 * Coordinate reliability-dependent listing controls without bypassing the
 * loader's cache or concurrency queue. Explicit ranking/filter modes request
 * every eligible candidate, treat idle and loading as pending, and freeze source
 * order until one complete ranking can be committed.
 */
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

	// `request` is the existing capped/deduped queue entrypoint. Ranking and
	// problem-filter modes deliberately request the complete eligible set rather
	// than relying on viewport actions that can leave off-screen rows idle forever.
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
			// A new/changed candidate set stands in its source order until every
			// snapshot reaches ready or empty. Never publish a partial ranking.
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
