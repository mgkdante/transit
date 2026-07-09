// quiet-mode.svelte.ts — the ONE site-wide FOCUS (quiet reading) store.
//
// Ported from yesid.dev's state/quiet-mode.svelte (P5-R R3; operator ruling
// 2026-07-10: FOCUS is default-OPEN + focus-to-close with ONE site-wide
// preference — the per-page localStorage keys /metrics carried are retired).
//
// Semantics (the yesid contract):
//   · enabled=false (the default): article surfaces render default-OPEN.
//   · toggle ON  → closeSignal bumps: every subscribed card + ToC rail folds.
//   · toggle OFF → openSignal bumps: every subscribed card + ToC rail reopens.
//   · REMEMBER pins the focused state across visits (ONE localStorage key for
//     the whole site); forgetting demotes FOCUS back to session-only, leaving
//     the on-screen state untouched.
//
// The signals are monotonic counters consumed by CollapsibleSection/TocNav's
// edge-triggered effects, so a fresh mount never fires them. `syncDocument`
// stamps `data-quiet-mode` on <html> for any CSS that wants the reading state.

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
			/* private mode / disabled storage — the in-memory state still works */
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
	/** Pin: engage FOCUS and remember it across visits. */
	rememberCurrent(): void {
		setEnabled(true);
		setRemembered(true);
	},
	/** Unpin: FOCUS becomes session-only; the on-screen state is untouched. */
	forgetDefault(): void {
		setRemembered(false);
	},
	/** Mount-time restore: a pinned FOCUS re-engages (bumping closeSignal so the
	 *  page paints folded); otherwise the default-open state stands. */
	init(): void {
		const stored = readRemembered();
		remembered = stored;
		if (stored) setEnabled(true);
	},
	/** Test seam — resets state + storage + the document stamp. */
	resetForTest(): void {
		enabled = false;
		remembered = false;
		closeSignal = 0;
		openSignal = 0;
		if (browser) {
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch {
				/* no-op */
			}
		}
		syncDocument(false);
	},
};
