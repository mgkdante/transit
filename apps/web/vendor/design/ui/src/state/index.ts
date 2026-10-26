import { quietMode as quietModeStore } from './quiet-mode.svelte.js';
import { theme as themeStore } from './theme.svelte.js';

export type Theme = 'dark' | 'light';

/**
 * Dark is the default. The app's pre-paint script owns first paint from the `theme` storage key;
 * `init()` adopts what it applied. System preference is intentionally ignored.
 */
export interface ThemeStore {
	readonly current: Theme;
	readonly isDark: boolean;
	set(next: Theme): void;
	toggle(): void;
	init(): void;
}

export interface QuietModeInit {
	readonly storageKey?: string;
}

/**
 * Collapses every collapsible section on request. Sections close on `closeSignal` and reopen on
 * `openSignal`; `init()` closes them when a remembered default exists and never issues an open.
 */
export interface QuietModeStore {
	readonly enabled: boolean;
	readonly remembered: boolean;
	readonly closeSignal: number;
	readonly openSignal: number;
	set(next: boolean): void;
	toggle(): void;
	rememberCurrent(): void;
	forgetDefault(): void;
	init(options?: QuietModeInit): void;
	resetForTest(): void;
}

export const theme: ThemeStore = themeStore;
export const quietMode: QuietModeStore = quietModeStore;
export { desktop, DESKTOP_MIN_WIDTH } from './desktop.js';
