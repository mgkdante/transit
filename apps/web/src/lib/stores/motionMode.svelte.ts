import { browser } from '$app/environment';

export type MotionMode = 'raw' | 'smooth';

export const MOTION_MODE_STORAGE_KEY = 'transit:motion-mode';

const DEFAULT_MOTION_MODE: MotionMode = 'raw';

function readStoredMode(): MotionMode {
	if (!browser) return DEFAULT_MOTION_MODE;
	try {
		return localStorage.getItem(MOTION_MODE_STORAGE_KEY) === 'smooth' ? 'smooth' : 'raw';
	} catch {
		return DEFAULT_MOTION_MODE;
	}
}

let mode = $state<MotionMode>(readStoredMode());

function set(next: MotionMode): void {
	mode = next;
	if (!browser) return;
	try {
		localStorage.setItem(MOTION_MODE_STORAGE_KEY, next);
	} catch {
		// Private mode or disabled storage leaves the motion choice in memory.
	}
}

export const motionMode = {
	get current(): MotionMode {
		return mode;
	},
	get isSmooth(): boolean {
		return mode === 'smooth';
	},
	set,
	toggle(): void {
		set(mode === 'raw' ? 'smooth' : 'raw');
	},
};
