import { untrack } from 'svelte';
import { quietMode, persisted, type Persisted } from '@yesid/ui/state';

export interface RailDisclosureController<Key extends string> {
	isOpen(key: Key): boolean;
	set(key: Key, next: boolean): void;
	setAll(next: boolean): void;
}

// Only reader actions are stored. Quiet mode overrides what each disclosure shows without
// touching storage, so Collapse all here and Expand all elsewhere leave no stale close behind.
export function createRailDisclosureController<
	const StorageKeys extends Readonly<Record<string, string>>,
>(storageKeys: StorageKeys): RailDisclosureController<Extract<keyof StorageKeys, string>> {
	type Key = Extract<keyof StorageKeys, string>;
	const entries = Object.entries(storageKeys) as Array<[Key, string]>;
	const disclosures = Object.fromEntries(
		entries.map(([key, storageKey]) => [key, persisted(storageKey, true)]),
	) as Record<Key, Persisted<boolean>>;
	let quietOverride = $state<Partial<Record<Key, boolean>>>({});

	function disclosure(key: Key): Persisted<boolean> {
		const value = disclosures[key];
		if (value == null) throw new Error(`Unknown rail disclosure: ${key}`);
		return value;
	}

	function set(key: Key, next: boolean): void {
		quietOverride = { ...quietOverride, [key]: undefined };
		disclosure(key).value = next;
	}

	function setAll(next: boolean): void {
		for (const [key] of entries) set(key, next);
	}

	function applyQuiet(open: boolean): void {
		quietOverride = Object.fromEntries(entries.map(([key]) => [key, open])) as Record<Key, boolean>;
	}

	untrack(() => {
		if (quietMode.enabled) applyQuiet(false);
	});

	let lastQuietSignals = untrack(() => `${quietMode.closeSignal}:${quietMode.openSignal}`);
	$effect(() => {
		const signals = `${quietMode.closeSignal}:${quietMode.openSignal}`;
		if (signals === lastQuietSignals) return;
		lastQuietSignals = signals;
		applyQuiet(!untrack(() => quietMode.enabled));
	});

	return {
		isOpen: (key) => quietOverride[key] ?? disclosure(key).value,
		set,
		setAll,
	};
}
