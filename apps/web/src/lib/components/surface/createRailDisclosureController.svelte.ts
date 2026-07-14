import { onMount, tick } from 'svelte';
import { persisted, type Persisted } from '$lib/stores';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

export interface RailDisclosureController<Key extends string> {
	isOpen(key: Key): boolean;
	set(key: Key, next: boolean): void;
	setAll(next: boolean): void;
}

export function createRailDisclosureController<
	const StorageKeys extends Readonly<Record<string, string>>,
>(storageKeys: StorageKeys): RailDisclosureController<Extract<keyof StorageKeys, string>> {
	type Key = Extract<keyof StorageKeys, string>;
	const entries = Object.entries(storageKeys) as Array<[Key, string]>;
	const disclosures = Object.fromEntries(
		entries.map(([key, storageKey]) => [key, persisted(storageKey, true)]),
	) as Record<Key, Persisted<boolean>>;

	function disclosure(key: Key): Persisted<boolean> {
		const value = disclosures[key];
		if (value == null) throw new Error(`Unknown rail disclosure: ${key}`);
		return value;
	}

	function set(key: Key, next: boolean): void {
		disclosure(key).value = next;
	}

	function setAll(next: boolean): void {
		for (const [key] of entries) set(key, next);
	}

	let signalsReady = $state(false);
	let lastCloseSignal = quietModeStore.closeSignal;
	let lastOpenSignal = quietModeStore.openSignal;

	onMount(() => {
		let cancelled = false;
		void (async () => {
			await tick();
			if (cancelled) return;
			lastCloseSignal = quietModeStore.closeSignal;
			lastOpenSignal = quietModeStore.openSignal;
			if (quietModeStore.enabled) setAll(false);
			signalsReady = true;
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const closeSignal = quietModeStore.closeSignal;
		const openSignal = quietModeStore.openSignal;
		if (!signalsReady) return;
		if (closeSignal !== lastCloseSignal) {
			lastCloseSignal = closeSignal;
			setAll(false);
		}
		if (openSignal !== lastOpenSignal) {
			lastOpenSignal = openSignal;
			setAll(true);
		}
	});

	return {
		isOpen: (key) => disclosure(key).value,
		set,
		setAll,
	};
}
