import type { AnalyticsConsentState } from './consent.svelte';

export interface AnalyticsControlsInput {
	enabled?: unknown;
	showBanner?: unknown;
}

export interface NormalizedAnalyticsControls {
	enabled: boolean;
	showBanner: boolean;
}

export interface AnalyticsPolicy extends NormalizedAnalyticsControls {
	canTrack: boolean;
	showPrompt: boolean;
	showPreferences: boolean;
}

export function normalizeAnalyticsControls(
	controls: AnalyticsControlsInput = {},
): NormalizedAnalyticsControls {
	return {
		enabled: controls.enabled !== false,
		showBanner:
			typeof controls.enabled === 'boolean' && typeof controls.showBanner === 'boolean'
				? controls.showBanner
				: true,
	};
}

export function getAnalyticsPolicy(
	controls: AnalyticsControlsInput,
	consent: AnalyticsConsentState,
): AnalyticsPolicy {
	const normalized = normalizeAnalyticsControls(controls);
	const operational = consent.ready && consent.available && normalized.enabled;

	if (!operational) {
		return {
			...normalized,
			canTrack: false,
			showPrompt: false,
			showPreferences: false,
		};
	}

	return {
		...normalized,
		canTrack:
			!consent.preferencesOpen &&
			(consent.choice === 'granted' ||
				(!normalized.showBanner && consent.choice === 'unknown')),
		showPrompt:
			consent.preferencesOpen ||
			(normalized.showBanner && consent.choice === 'unknown'),
		showPreferences: true,
	};
}
