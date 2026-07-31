import type { Locale } from '$lib/i18n';

const STRUCTURAL_LABELS = {
	en: {
		row: 'row',
		group: 'group',
		x: 'x',
		gap: 'gap',
		confidenceInterval95: '95% CI',
		tripsTitle: 'Trips',
		tripsLower: 'trips',
		share: 'Share',
		binMinutes: 'bin (min)',
		rangeTo: 'to',
	},
	fr: {
		row: 'ligne',
		group: 'groupe',
		x: 'axe x',
		gap: 'écart',
		confidenceInterval95: 'IC 95 %',
		tripsTitle: 'Voyages',
		tripsLower: 'voyages',
		share: 'Part',
		binMinutes: 'intervalle (min)',
		rangeTo: 'à',
	},
} as const;

/**
 * Shared mark-level structural copy. Mathematical notation `n` and `%` is intentionally
 * language-neutral and must not be localized.
 */
export function structuralLabels(locale: Locale) {
	return STRUCTURAL_LABELS[locale];
}
