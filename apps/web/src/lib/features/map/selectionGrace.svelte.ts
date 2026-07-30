/**
 * Selection grace keeps a committed vehicle panel open across two genuinely new
 * successful vehicle snapshots that omit it. It is deliberately scoped to
 * vehicles: route and stop detail ownership remains in MapHero.
 */

export type SelectionPresence = 'loading' | 'present' | 'missing-grace' | 'gone';
export type SelectionSourceHealth = 'ok' | 'retrying' | 'failed';

/** Narrow structural view of the vehicles family state consumed by this machine. */
export interface VehiclesFamilyTruth {
	readonly phase: 'idle' | 'loading' | 'ready' | 'failed';
	readonly retainedGeneration: string | null;
	readonly consecutiveFailures: number;
	readonly error: Error | null;
	readonly successRevision: number;
}

export interface CommittedVehicleSelection {
	readonly kind: 'vehicle';
	readonly id: string;
}

export interface SelectionGraceInput<T> {
	/** Committed selection only. Hover must never participate in this machine. */
	readonly selection: CommittedVehicleSelection | null;
	/** The currently resolvable selected-vehicle detail, or null when absent/not ready. */
	readonly resolvedDetail: T | null;
	readonly vehicles: VehiclesFamilyTruth;
}

export interface SelectionGraceState<T> {
	readonly presence: SelectionPresence;
	readonly sourceHealth: SelectionSourceHealth;
	/** Current detail when present, otherwise the retained last known valid detail during grace. */
	readonly detail: T | null;
	readonly omissionCount: number;
}

export interface SelectionGrace<T> {
	readonly state: SelectionGraceState<T>;
	update(input: SelectionGraceInput<T>): SelectionGraceState<T>;
}

const EMPTY_STATE: SelectionGraceState<never> = {
	presence: 'loading',
	sourceHealth: 'ok',
	detail: null,
	omissionCount: 0,
};

/**
 * Family health is intentionally independent of detail presence:
 * - `failed` phase is failed;
 * - `loading` after one or more failures is retrying;
 * - every other phase is ok.
 *
 * This makes retained detail visible during a source failure without claiming
 * that the source itself is healthy.
 */
function sourceHealth(vehicles: VehiclesFamilyTruth): SelectionSourceHealth {
	if (vehicles.phase === 'failed') return 'failed';
	if (vehicles.phase === 'loading' && vehicles.consecutiveFailures > 0) return 'retrying';
	return 'ok';
}

/** Create one state machine for one MapHero instance. */
export function createSelectionGrace<T>(): SelectionGrace<T> {
	let selectedId: string | null = null;
	let lastObservedSuccessRevision: number | null = null;
	let retainedDetail: T | null = null;
	let omissionCount = 0;
	// MapHero owns the reactive output. Keeping this machine state plain prevents
	// its update effect from subscribing to and retriggering on its own write.
	let state: SelectionGraceState<T> = EMPTY_STATE as SelectionGraceState<T>;

	function update(input: SelectionGraceInput<T>): SelectionGraceState<T> {
		const nextSelectedId = input.selection?.id ?? null;
		const identityChanged = nextSelectedId !== selectedId;

		if (identityChanged) {
			selectedId = nextSelectedId;
			lastObservedSuccessRevision = nextSelectedId === null ? null : input.vehicles.successRevision;
			retainedDetail = input.resolvedDetail;
			omissionCount = 0;
		} else if (nextSelectedId !== null) {
			if (input.resolvedDetail !== null) {
				retainedDetail = input.resolvedDetail;
				omissionCount = 0;
			}

			// successRevision advances only on a changed, successfully committed
			// vehicles payload. Failures, aborts, same-generation reuse, and unrelated
			// family settlements retain it.
			const committedVehicleSuccess =
				input.vehicles.phase === 'ready' &&
				lastObservedSuccessRevision !== null &&
				input.vehicles.successRevision > lastObservedSuccessRevision;
			if (input.resolvedDetail === null && committedVehicleSuccess) {
				omissionCount += 1;
			}
			if (input.vehicles.phase === 'ready') {
				lastObservedSuccessRevision = Math.max(
					lastObservedSuccessRevision ?? input.vehicles.successRevision,
					input.vehicles.successRevision,
				);
			}
		}

		const health = sourceHealth(input.vehicles);
		const presence: SelectionPresence =
			nextSelectedId === null
				? 'loading'
				: input.resolvedDetail !== null
					? 'present'
					: omissionCount >= 3
						? 'gone'
						: omissionCount > 0
							? 'missing-grace'
							: retainedDetail !== null
								? 'present'
								: 'loading';
		const visibleDetail = presence === 'gone' ? null : retainedDetail;

		state = { presence, sourceHealth: health, detail: visibleDetail, omissionCount };
		return state;
	}

	return {
		get state() {
			return state;
		},
		update,
	};
}
