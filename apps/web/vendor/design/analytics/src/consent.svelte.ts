import { writable, type Readable } from 'svelte/store';
import type { AnalyticsPreset } from './config';

export type AnalyticsConsentChoice = 'unknown' | 'granted' | 'denied';
type DurableAnalyticsConsentChoice = Exclude<AnalyticsConsentChoice, 'unknown'>;

export interface AnalyticsConsentState {
	choice: AnalyticsConsentChoice;
	ready: boolean;
	available: boolean;
	preferencesOpen: boolean;
}

export interface AnalyticsConsentDependencies {
	hostname: () => string;
	probeDurableStorage: () => void;
	read: () => string | null;
	write: (value: DurableAnalyticsConsentChoice) => void;
	remove: () => void;
	readPreferencesMarker: () => string | null;
	writePreferencesMarker: (choice: AnalyticsConsentChoice) => void;
	removePreferencesMarker: () => void;
	readSafetyMarker: () => string | null;
	writeSafetyMarker: () => void;
	removeSafetyMarker: () => void;
	reload: () => void;
	listen: (listener: (value: string | null) => void) => () => void;
}

interface DurableStorageProbeTarget {
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
}

export function probeDurableAnalyticsStorage(
	storage: DurableStorageProbeTarget,
	storageProbeKey: string,
): void {
	storage.setItem(storageProbeKey, '1');
	storage.removeItem(storageProbeKey);
}

export interface AnalyticsConsentStore extends Readable<AnalyticsConsentState> {
	preferencesFocusRequests: Readable<number>;
	init: () => () => void;
	grant: () => void;
	deny: () => void;
	openPreferences: () => void;
}

const INITIAL_STATE: AnalyticsConsentState = {
	choice: 'unknown',
	ready: false,
	available: false,
	preferencesOpen: false,
};

function isDurableChoice(value: string | null): value is DurableAnalyticsConsentChoice {
	return value === 'granted' || value === 'denied';
}

export function createAnalyticsConsentStore(
	preset: AnalyticsPreset,
	dependencies: AnalyticsConsentDependencies,
): AnalyticsConsentStore {
	const { subscribe, set } = writable<AnalyticsConsentState>(INITIAL_STATE);
	const preferencesFocusRequests = writable(0);
	let current = INITIAL_STATE;
	let focusRequest = 0;
	let storageSafetyFailed = false;
	let stopListening: (() => void) | null = null;

	function commit(next: AnalyticsConsentState): void {
		current = next;
		set(next);
	}

	function requestPreferencesFocus(): void {
		focusRequest += 1;
		preferencesFocusRequests.set(focusRequest);
	}

	function refreshOpenMarker(choice: AnalyticsConsentChoice): void {
		if (!current.preferencesOpen) return;
		try {
			dependencies.writePreferencesMarker(choice);
			storageSafetyFailed = false;
		} catch {
			// The in-memory preferences gate remains fail-closed for this runtime.
		}
	}

	function clearPreferencesMarker(): void {
		try {
			dependencies.removePreferencesMarker();
		} catch {
			// A stale marker can reopen preferences on the next load, which remains fail-closed.
		}
	}

	function clearSafetyMarker(): void {
		try {
			dependencies.removeSafetyMarker();
		} catch {
			// A failed cleanup remains fail-closed on the next load.
		}
	}

	function stopStorageListener(): void {
		stopListening?.();
		stopListening = null;
	}

	function commitUnavailable(choice: AnalyticsConsentChoice = 'unknown'): void {
		clearPreferencesMarker();
		commit({ choice, ready: true, available: false, preferencesOpen: false });
	}

	function syncExternalChoice(value: string | null): void {
		if (!current.ready || !current.available) return;
		if (value === 'granted') {
			clearSafetyMarker();
			refreshOpenMarker('granted');
			commit({ ...current, choice: 'granted' });
			return;
		}
		if (!isDurableChoice(value)) {
			let denialPersisted = false;
			let safetyPersisted = false;
			try {
				dependencies.write('denied');
				denialPersisted = true;
				safetyPersisted = true;
			} catch {
				try {
					dependencies.writeSafetyMarker();
					safetyPersisted = true;
				} catch {
					// Without either safety signal, this runtime must remain unavailable.
				}
			}
			storageSafetyFailed = !safetyPersisted;
			if (denialPersisted) clearSafetyMarker();
			refreshOpenMarker('denied');
			commit({
				...current,
				choice: 'denied',
				available: safetyPersisted,
			});
			return;
		}

		// A durable denial stops this tab immediately. A grant cannot close a prompt
		// that this tab's user explicitly opened.
		refreshOpenMarker('denied');
		commit({
			...current,
			choice: 'denied',
		});
	}

	function chooseGranted(): void {
		try {
			dependencies.write('granted');
			storageSafetyFailed = false;
		} catch {
			// The page may keep the choice in memory, but the next load must read storage again.
		}
		clearPreferencesMarker();
		clearSafetyMarker();
		commit({ ...current, choice: 'granted', preferencesOpen: false });
	}

	function chooseDenied(): void {
		let denialPersisted = false;
		try {
			dependencies.write('denied');
			denialPersisted = true;
		} catch {
			// Establish a second safety signal before disturbing a possibly stale grant.
		}

		if (denialPersisted) {
			storageSafetyFailed = false;
			clearPreferencesMarker();
			clearSafetyMarker();
			commit({ ...current, choice: 'denied', preferencesOpen: false });
			return;
		}

		let safetyMarkerWritten = false;
		try {
			dependencies.writeSafetyMarker();
			safetyMarkerWritten = true;
		} catch {
			// A durable denial may still provide the safety signal after stale-choice removal.
		}

		let staleChoiceRemoved = false;
		try {
			dependencies.remove();
			staleChoiceRemoved = true;
		} catch {
			// The denial safety marker still prevents a surviving grant from being restored.
		}

		if (staleChoiceRemoved) {
			try {
				dependencies.write('denied');
				denialPersisted = true;
			} catch {
				// Keep the marker when the durable retry also fails.
			}
		}

		if (denialPersisted) {
			storageSafetyFailed = false;
			clearPreferencesMarker();
			clearSafetyMarker();
			commit({ ...current, choice: 'denied', preferencesOpen: false });
			return;
		}

		if (safetyMarkerWritten) {
			storageSafetyFailed = false;
			clearPreferencesMarker();
			commit({ ...current, choice: 'denied', preferencesOpen: false });
			return;
		}

		storageSafetyFailed = true;
		clearPreferencesMarker();
		commit({
			...current,
			choice: 'denied',
			available: false,
			preferencesOpen: false,
		});
	}

	return {
		subscribe,
		preferencesFocusRequests,
		init(): () => void {
			stopStorageListener();
			const available = dependencies.hostname() === preset.domain;
			if (!available) {
				commitUnavailable();
				return () => {};
			}
			try {
				dependencies.probeDurableStorage();
			} catch {
				commitUnavailable();
				return () => {};
			}
			if (storageSafetyFailed) {
				commitUnavailable(current.choice);
				return () => {};
			}

			let stored: string | null;
			try {
				stored = dependencies.read();
			} catch {
				commitUnavailable();
				return () => {};
			}

			let preferencesMarker: string | null;
			try {
				preferencesMarker = dependencies.readPreferencesMarker();
			} catch {
				commitUnavailable();
				return () => {};
			}

			let safetyMarker: string | null;
			try {
				safetyMarker = dependencies.readSafetyMarker();
			} catch {
				commitUnavailable();
				return () => {};
			}

			const markerChoice = isDurableChoice(preferencesMarker)
				? preferencesMarker
				: preferencesMarker === 'unknown'
					? 'unknown'
					: null;
			const preferencesOpen = preferencesMarker === '1' || markerChoice !== null;
			let unsubscribe: () => void;
			try {
				unsubscribe = dependencies.listen(syncExternalChoice);
			} catch {
				commitUnavailable();
				return () => {};
			}
			stopListening = unsubscribe;
			const choice =
				markerChoice ??
				(safetyMarker === '1'
					? 'denied'
					: preferencesOpen && stored === 'granted'
						? 'unknown'
						: isDurableChoice(stored)
							? stored
							: 'unknown');
			commit({
				choice,
				ready: true,
				available: true,
				preferencesOpen,
			});
			if (preferencesOpen) {
				refreshOpenMarker(choice);
				requestPreferencesFocus();
			} else if (preferencesMarker !== null) {
				clearPreferencesMarker();
			}
			return () => {
				if (stopListening === unsubscribe) stopListening = null;
				unsubscribe();
			};
		},
		grant(): void {
			chooseGranted();
		},
		deny(): void {
			chooseDenied();
		},
		openPreferences(): void {
			const previousChoice = current.choice;
			const wasPreferencesOpen = current.preferencesOpen;
			let markerWritten = false;
			try {
				dependencies.writePreferencesMarker(previousChoice);
				markerWritten = true;
				storageSafetyFailed = false;
			} catch {
				// Without the marker, do not reload; keep the in-memory pause active instead.
			}

			let durablyRevoked = false;
			try {
				dependencies.remove();
				durablyRevoked = true;
			} catch {
				try {
					dependencies.write('denied');
					durablyRevoked = true;
				} catch {
					// Keep the prior choice visible and avoid reloading a grant that may have survived.
				}
			}

			if (!durablyRevoked) {
				try {
					dependencies.writeSafetyMarker();
				} catch {
					// The in-memory preferences gate still blocks tracking in this runtime.
				}
			}

			if (!markerWritten) {
				try {
					dependencies.write('denied');
					durablyRevoked = true;
					storageSafetyFailed = false;
				} catch {
					storageSafetyFailed = true;
					commit({
						...current,
						choice: previousChoice,
						available: true,
						preferencesOpen: true,
					});
					requestPreferencesFocus();
					return;
				}
			}
			commit({ ...current, choice: previousChoice, preferencesOpen: true });
			requestPreferencesFocus();
			if (
				!wasPreferencesOpen &&
				previousChoice === 'granted' &&
				durablyRevoked &&
				markerWritten
			) {
				try {
					dependencies.reload();
				} catch {
					// Reload can be unavailable in embedded browsers; the prior choice remains in memory.
				}
			}
		},
	};
}
