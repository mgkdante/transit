const STORAGE_KEY = 'quiet-mode';

let enabled = $state(false);
let remembered = $state(false);
let closeSignal = $state(0);
let openSignal = $state(0);

function readRemembered() {
	try {
		return localStorage.getItem(STORAGE_KEY) === 'true';
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
		if (next) localStorage.setItem(STORAGE_KEY, 'true');
		else localStorage.removeItem(STORAGE_KEY);
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
	init() {
		if (typeof window === 'undefined') return;
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
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Disabled storage must not block the in-memory reset.
		}
		syncDocument(false);
	},
};
