// motionMode — the honest "how do we draw moving buses?" switch.
//
// Two modes, RAW the default:
//   raw    — ping-on-load. Each ~30s live feed SNAPS every bus to its last
//            reported position. No estimation, no forward projection: the dot is
//            exactly where the GTFS-RT fix put it. Honest, but it jumps.
//   smooth — "almost real-time". Between feeds the motion controller dead-reckons
//            each bus FORWARD off its own fix time + speed along its route shape,
//            so the dot glides toward where the bus probably is now. An estimate
//            (admittedly still a touch laggy) — the toggle + /metrics explainer
//            keep it honest.
//
// Raw is the default precisely because it never invents a position. Smooth is the
// opt-in approximation. Persisted to localStorage so the choice sticks across
// reloads. SSR-safe: every localStorage touch is browser-guarded, and the initial
// value resolves to 'raw' with no JS / no stored choice.

import { browser } from '$app/environment';

export type MotionMode = 'raw' | 'smooth';

/** The localStorage key the choice persists under. */
export const MOTION_MODE_STORAGE_KEY = 'transit:motion-mode';

/** Raw is the honest default: never estimate a position the feed did not report. */
const DEFAULT_MOTION_MODE: MotionMode = 'raw';

/** Read the persisted choice, falling back to the default on SSR / absent / junk. */
function readStoredMode(): MotionMode {
	if (!browser) return DEFAULT_MOTION_MODE;
	try {
		return localStorage.getItem(MOTION_MODE_STORAGE_KEY) === 'smooth' ? 'smooth' : 'raw';
	} catch {
		// Private mode / disabled storage — session-only is fine, fall back to raw.
		return DEFAULT_MOTION_MODE;
	}
}

let mode = $state<MotionMode>(readStoredMode());

/** Apply a mode to the runes state and (browser-only) persist it. */
function set(next: MotionMode): void {
	mode = next;
	if (!browser) return;
	try {
		localStorage.setItem(MOTION_MODE_STORAGE_KEY, next);
	} catch {
		/* private mode / disabled storage — session-only choice is fine */
	}
}

export const motionMode = {
	/** Reactive current mode ('raw' | 'smooth'). Read inside a reactive context to track. */
	get current(): MotionMode {
		return mode;
	},
	/** True when forward-projection (smooth) is active. */
	get isSmooth(): boolean {
		return mode === 'smooth';
	},
	/** Set the mode explicitly and persist the choice. */
	set,
	/** Flip raw <-> smooth, persisting the result. */
	toggle(): void {
		set(mode === 'raw' ? 'smooth' : 'raw');
	},
};
