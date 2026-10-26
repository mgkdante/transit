export interface QuietModeInit {
	readonly storageKey?: string;
}

const DEFAULT_STORAGE_KEY = 'quiet-mode';

let storageKey = DEFAULT_STORAGE_KEY;
let enabled = $state(false);
let remembered = $state(false);
let closeSignal = $state(0);
let openSignal = $state(0);

function readRemembered(): boolean {
	try {
		return localStorage.getItem(storageKey) === 'true';
	} catch {
		return false;
	}
}

function syncDocument(next: boolean): void {
	if (typeof document === 'undefined') return;
	if (next) document.documentElement.dataset.quietMode = 'true';
	else delete document.documentElement.dataset.quietMode;
	document.dispatchEvent(new CustomEvent('quietmodechange', { detail: { enabled: next } }));
}

function setEnabled(next: boolean): void {
	enabled = next;
	if (next) closeSignal += 1;
	else openSignal += 1;
	syncDocument(next);
}

function setRemembered(next: boolean): void {
	remembered = next;
	try {
		if (next) localStorage.setItem(storageKey, 'true');
		else localStorage.removeItem(storageKey);
	} catch {
		// Storage can be unavailable in private mode; the state still applies in memory.
	}
}

/**
 * Collapses every collapsible section on request. Sections close on `closeSignal` and reopen on
 * `openSignal`; `init()` closes them when a remembered default exists and never issues an open.
 */
export const quietMode = {
	get enabled(): boolean {
		return enabled;
	},
	get remembered(): boolean {
		return remembered;
	},
	get closeSignal(): number {
		return closeSignal;
	},
	get openSignal(): number {
		return openSignal;
	},
	set(next: boolean): void {
		setEnabled(next);
	},
	toggle(): void {
		setEnabled(!enabled);
	},
	rememberCurrent(): void {
		setEnabled(true);
		setRemembered(true);
	},
	forgetDefault(): void {
		setRemembered(false);
	},
	init(options: QuietModeInit = {}): void {
		if (typeof window === 'undefined') return;
		storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
		remembered = readRemembered();
		if (remembered) setEnabled(true);
		else syncDocument(enabled);
	},
	resetForTest(): void {
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
