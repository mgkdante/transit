// quiet-mode.svelte.ts — the ONE site-wide article-collapse preference store.
//
// Ported from yesid.dev's state/quiet-mode.svelte while retaining Transit's
// localStorage key.
//
// Semantics (the yesid contract):
//   · enabled=false (the default): article surfaces render default-OPEN.
//   · toggle ON  → closeSignal bumps: every subscribed card + ToC rail folds.
//   · toggle OFF → openSignal bumps: every subscribed card + ToC rail reopens.
//   · "Always start collapsed" engages + persists the collapsed state under one
//     site-wide key; "Don't start collapsed" clears only that preference.
//
// The signals are monotonic counters consumed by CollapsibleSection/TocNav's
// edge-triggered effects. `init()` intentionally emits the stored state after an
// article mounts. `syncDocument` stamps `data-quiet-mode` on <html> for CSS.

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
	/** Engage the collapsed state and remember it across visits. */
	rememberCurrent(): void {
		setEnabled(true);
		setRemembered(true);
	},
	/** Clear the default; the on-screen state is untouched. */
	forgetDefault(): void {
		setRemembered(false);
	},
	/** Mount-time restore: every article starts from the stored boolean. */
	init(): void {
		const stored = readRemembered();
		remembered = stored;
		setEnabled(stored);
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
