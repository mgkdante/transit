const DEFAULT_STORAGE_KEY = 'quiet-mode';

let storageKey = DEFAULT_STORAGE_KEY;
let enabled = $state(false);
let remembered = $state(false);
let closeSignal = $state(0);
let openSignal = $state(0);

function readRemembered() {
	try {
		return localStorage.getItem(storageKey) === 'true';
	} catch {
		return false;
	}
}

/** @param {boolean} next */
function syncDocument(next) {
	if (typeof document === 'undefined') return;
	if (next) document.documentElement.dataset.quietMode = 'true';
	else delete document.documentElement.dataset.quietMode;
	document.dispatchEvent(new CustomEvent('quietmodechange', { detail: { enabled: next } }));
}

/** @param {boolean} next */
function setEnabled(next) {
	enabled = next;
	if (next) closeSignal += 1;
	else openSignal += 1;
	syncDocument(next);
}

/** @param {boolean} next */
function setRemembered(next) {
	remembered = next;
	try {
		if (next) localStorage.setItem(storageKey, 'true');
		else localStorage.removeItem(storageKey);
	} catch {
		// Storage can be unavailable in private mode; the state still applies in memory.
	}
}

export const quietMode = {
	get enabled() {
		return enabled;
	},
	get remembered() {
		return remembered;
	},
	get closeSignal() {
		return closeSignal;
	},
	get openSignal() {
		return openSignal;
	},
	/** @param {boolean} next */
	set(next) {
		setEnabled(next);
	},
	toggle() {
		setEnabled(!enabled);
	},
	rememberCurrent() {
		setEnabled(true);
		setRemembered(true);
	},
	forgetDefault() {
		setRemembered(false);
	},
	/** @param {import('./quiet-mode.svelte.js').QuietModeInit} [options] */
	init(options = {}) {
		if (typeof window === 'undefined') return;
		storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
		remembered = readRemembered();
		if (remembered) setEnabled(true);
		else syncDocument(enabled);
	},
	resetForTest() {
		enabled = false;
		remembered = false;
		closeSignal = 0;
		openSignal = 0;
		try {
			localStorage.removeItem(storageKey);
		} catch {
			// Disabled storage must not block the in-memory reset.
		}
		storageKey = DEFAULT_STORAGE_KEY;
		syncDocument(false);
	},
};
