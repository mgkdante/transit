/**
 * One-line opt-in for a piece of component state to survive within a browser
 * tab (e.g. a section's open/closed state surviving a locale navigation).
 *
 *   const open = persisted('metrics-overview', true);
 *   <Collapsible bind:open={() => open.value, (v) => (open.value = v)} />
 *
 * Transit-native port of yesid.dev's `persisted` rune. Yesid couples its
 * version to a locale-handoff orchestrator; transit has no such orchestrator,
 * so this version backs the value with `sessionStorage` instead. The value
 * survives a same-tab navigation (the /fr <-> /en locale switch is a full
 * SvelteKit navigation here, which remounts components) and is dropped when the
 * tab closes. The stored value MUST be a locale-free primitive (an
 * id/slug/bool/number/array, never a translated string) so the same value is
 * valid in any locale.
 *
 * Keep the binding plain: `open.value` reads/writes a real `$state` underneath.
 */
import { browser } from '$app/environment';

export type LocaleFree = string | number | boolean | null | LocaleFree[];

/**
 * Widen inferred literal types so `persisted('q', '')` is a `string` rune (not a
 * `''` rune that can't be reassigned) and `persisted('n', 0)` a `number` rune.
 * Union/nullable values can't be inferred from the seed, so pass them
 * explicitly, e.g. `persisted<Locale | null>('lang', null)`.
 */
// Non-distributive ([T] extends [string]) on purpose: a bare literal seed widens
// to its base ('' -> string), but an explicit UNION is preserved.
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
		// Storage disabled (private mode quota, etc.) or corrupt JSON: fall back
		// to the seed. Persistence is a nicety, never a correctness requirement.
		return undefined;
	}
}

function write<V extends LocaleFree>(key: string, value: V): void {
	if (!browser) return;
	try {
		sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
	} catch {
		// Ignore write failures (quota / disabled storage).
	}
}

export function persisted<T extends LocaleFree>(key: string, initial: T): Persisted<Widen<T>> {
	type V = Widen<T>;
	// Seed SYNCHRONOUSLY from sessionStorage so the consumer paints directly in
	// its restored state, with no default-then-restore flash (e.g. a collapsible
	// would otherwise render open for a frame then animate shut).
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
