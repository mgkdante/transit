const PREFIX = 'persisted:';

// `document` marks a real browser. Node 25+ also defines a process-wide sessionStorage,
// which would share state across server requests.
const inBrowser = () => typeof document !== 'undefined';

/** @param {string} key */
function read(key) {
	if (!inBrowser()) return undefined;
	try {
		const raw = sessionStorage.getItem(PREFIX + key);
		return raw === null ? undefined : JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function write(key, value) {
	if (!inBrowser()) return;
	try {
		sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		// Storage can be full or disabled; the in-memory value still applies.
	}
}

/**
 * @param {string} key
 * @param {import('./index.js').LocaleFree} initial
 */
export function persisted(key, initial) {
	const seeded = read(key);
	let current = $state(seeded !== undefined ? seeded : initial);

	return {
		get value() {
			return current;
		},
		set value(next) {
			current = next;
			write(key, next);
		},
	};
}
