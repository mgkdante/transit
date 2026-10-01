import { browser } from '$app/environment';

const STORAGE_KEY = 'transit:quiet-mode';

function readRemembered(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(STORAGE_KEY) === 'true';
	} catch {
		return false;
	}
}

let enabled = $state(false);
let remembered = $state(false);
let closeSignal = $state(0);
let openSignal = $state(0);

function syncDocument(next: boolean): void {
	if (!browser) return;
	if (next) document.documentElement.dataset.quietMode = 'true';
	else delete document.documentElement.dataset.quietMode;
}

function setEnabled(next: boolean): void {
	enabled = next;
	if (next) closeSignal += 1;
	else openSignal += 1;
	syncDocument(next);
}

function setRemembered(next: boolean): void {
	remembered = next;
	if (browser) {
		try {
			if (next) localStorage.setItem(STORAGE_KEY, 'true');
			else localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Private mode or disabled storage leaves the state in memory.
		}
	}
}

export const quietModeStore = {
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
	init(): void {
		const stored = readRemembered();
		remembered = stored;
		setEnabled(stored);
	},
	resetForTest(): void {
		enabled = false;
		remembered = false;
		closeSignal = 0;
		openSignal = 0;
		if (browser) {
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch {
				// Disabled storage must not block the in-memory reset.
			}
		}
		syncDocument(false);
	},
};
