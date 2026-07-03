// verticalSectionTitle.copy — the localized D2 edge words.
//
// The rotated left-gutter section word is DECIDED copy (P5.3c · D2): the FR
// forms «Réseau.» / «Fiabilité.» / «Mesure.» with the EN equivalents. The
// component appends the period itself, so these carry only the WORD.
//
// Keyed by surface so the three D2 consumers (/network, /lines/[id], /metrics)
// stay in lockstep with one source of truth. Decorative + aria-hidden at the
// render site, so this never needs an a11y-visible variant.

import type { Locale } from '$lib/i18n';

export type VerticalSectionTitleKey = 'network' | 'reliability' | 'measure';

const WORDS: Record<VerticalSectionTitleKey, Record<Locale, string>> = {
	network: { en: 'Network', fr: 'Réseau' },
	reliability: { en: 'Reliability', fr: 'Fiabilité' },
	measure: { en: 'Measure', fr: 'Mesure' },
};

/** The localized edge word for a D2 surface (period is added by the component). */
export function verticalSectionTitleWord(key: VerticalSectionTitleKey, locale: Locale): string {
	return WORDS[key][locale];
}
