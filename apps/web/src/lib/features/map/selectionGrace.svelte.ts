export type SelectionPresence = 'loading' | 'present' | 'missing-grace' | 'gone';
export type SelectionSourceHealth = 'ok' | 'retrying' | 'failed';

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
	readonly selection: CommittedVehicleSelection | null;
	readonly resolvedDetail: T | null;
	readonly vehicles: VehiclesFamilyTruth;
}

export interface SelectionGraceState<T> {
	readonly presence: SelectionPresence;
	readonly sourceHealth: SelectionSourceHealth;
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

function sourceHealth(vehicles: VehiclesFamilyTruth): SelectionSourceHealth {
	if (vehicles.phase === 'failed') return 'failed';
	if (vehicles.phase === 'loading' && vehicles.consecutiveFailures > 0) return 'retrying';
	return 'ok';
}

export function createSelectionGrace<T>(): SelectionGrace<T> {
	let selectedId: string | null = null;
	let lastObservedSuccessRevision: number | null = null;
	let retainedDetail: T | null = null;
	let omissionCount = 0;
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
