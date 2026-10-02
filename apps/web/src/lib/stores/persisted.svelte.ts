import { browser } from '$app/environment';

export type LocaleFree = string | number | boolean | null | LocaleFree[];

type Widen<T> = [T] extends [string]
	? string
	: [T] extends [number]
		? number
		: [T] extends [boolean]
			? boolean
			: T;

export interface Persisted<T extends LocaleFree> {
	value: T;
}

const STORAGE_PREFIX = 'transit.persisted:';

function read<V extends LocaleFree>(key: string): V | undefined {
	if (!browser) return undefined;
	try {
		const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
		return raw === null ? undefined : (JSON.parse(raw) as V);
	} catch {
		return undefined;
	}
}

function write<V extends LocaleFree>(key: string, value: V): void {
	if (!browser) return;
	try {
		sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
	} catch {
		// Ignore write failures from quota limits or disabled storage.
	}
}

export function persisted<T extends LocaleFree>(key: string, initial: T): Persisted<Widen<T>> {
	type V = Widen<T>;
	const seeded = read<V>(key);
	let current = $state<V>(seeded !== undefined ? seeded : (initial as unknown as V));

	return {
		get value() {
			return current;
		},
		set value(next: V) {
			current = next;
			write(key, next);
		},
	};
}
