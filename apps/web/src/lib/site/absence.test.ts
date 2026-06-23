// absence.test.ts — the pure unknown-data LOGIC gate.
//
// Gates the shared missing-data layer:
//   - the unified AbsenceReasonKey covers the service-window keys + the new
//     value-absence keys, and ABSENCE_COPY has EN+FR short+why for EVERY one
//     (parity, non-empty, no em dash, no provider literal);
//   - Maybe helpers known()/absent() build the discriminated value;
//   - describeAbsence interpolates params + returns the calm "unknown" tone;
//   - fieldAbsenceReason picks not-reporting (stale) vs not-reported.

import { describe, it, expect } from 'vitest';
import {
	ABSENCE_COPY,
	describeAbsence,
	known,
	absent,
	fieldAbsenceReason,
	type AbsenceReasonKey,
} from './absence';
import type { Locale } from '$lib/i18n';

const LOCALES: Locale[] = ['en', 'fr'];

// Every key the unified vocabulary must carry (service-window + value-absence).
const ALL_KEYS: AbsenceReasonKey[] = [
	'metro-no-realtime',
	'closed-opens-at',
	'overnight-opens-at',
	'before-open',
	'scheduled-silent',
	'last-seen',
	'not-reported',
	'not-reporting',
	'not-in-schedule',
	'no-prediction',
	'end-of-route',
	'inferred',
];

// Provider literals copy must NEVER contain (provider-agnostic invariant).
const PROVIDER_LITERALS = ['STM', 'STO', 'OC', 'STS', 'métro', 'metro'];

describe('ABSENCE_COPY — bilingual parity for every reason key', () => {
	for (const lang of LOCALES) {
		for (const key of ALL_KEYS) {
			it(`${key} has non-empty short + why (${lang})`, () => {
				const block = ABSENCE_COPY[lang][key];
				expect(block, `missing copy for ${key} (${lang})`).toBeDefined();
				expect(block.short.trim().length).toBeGreaterThan(0);
				expect(block.why.trim().length).toBeGreaterThan(0);
			});
		}
	}

	it('EN and FR cover the EXACT same key set (no orphan key in either locale)', () => {
		expect(Object.keys(ABSENCE_COPY.en).sort()).toEqual(Object.keys(ABSENCE_COPY.fr).sort());
		expect(Object.keys(ABSENCE_COPY.en).sort()).toEqual([...ALL_KEYS].sort());
	});

	it('no copy string uses an em dash (brand voice)', () => {
		for (const lang of LOCALES) {
			for (const key of ALL_KEYS) {
				const { short, why } = ABSENCE_COPY[lang][key];
				expect(short.includes('—'), `${key}.short (${lang})`).toBe(false);
				expect(why.includes('—'), `${key}.why (${lang})`).toBe(false);
			}
		}
	});

	it('no copy string names a transit provider (provider-agnostic)', () => {
		for (const lang of LOCALES) {
			for (const key of ALL_KEYS) {
				const text = `${ABSENCE_COPY[lang][key].short} ${ABSENCE_COPY[lang][key].why}`;
				for (const literal of PROVIDER_LITERALS) {
					expect(
						text.includes(literal),
						`${key} (${lang}) contains provider literal "${literal}"`,
					).toBe(false);
				}
			}
		}
	});
});

describe('Maybe helpers — known() / absent()', () => {
	it('known() wraps a present value with the true discriminant', () => {
		const m = known(42);
		expect(m).toEqual({ known: true, value: 42 });
		if (m.known) expect(m.value).toBe(42); // narrows
	});

	it('absent() carries the reason key (no params)', () => {
		expect(absent('not-reported')).toEqual({ known: false, reason: 'not-reported' });
	});

	it('absent() carries the reason key + copy params', () => {
		expect(absent('closed-opens-at', { first: '06:00' })).toEqual({
			known: false,
			reason: 'closed-opens-at',
			params: { first: '06:00' },
		});
	});
});

describe('describeAbsence — pure resolver', () => {
	it('returns label + why + the calm "unknown" tone', () => {
		const d = describeAbsence('not-reported', 'en');
		expect(d).toEqual({
			label: 'Unknown',
			why: 'not reported in the live feed',
			tone: 'unknown',
		});
	});

	it('mirrors the same reason in FR', () => {
		expect(describeAbsence('not-reporting', 'fr')).toEqual({
			label: 'Obsolète',
			why: 'ce véhicule ne se signale pas',
			tone: 'unknown',
		});
	});

	it('interpolates {first} into the opens-at copy (EN + FR)', () => {
		expect(describeAbsence('closed-opens-at', 'en', { first: '06:00' }).why).toBe(
			'service is closed, opens at 06:00',
		);
		expect(describeAbsence('closed-opens-at', 'fr', { first: '06:00' }).why).toBe(
			'service terminé, reprise à 06:00',
		);
	});

	it('interpolates {age} into the last-seen copy', () => {
		expect(describeAbsence('last-seen', 'en', { age: '3 min ago' }).why).toBe(
			'last seen 3 min ago',
		);
	});

	it('leaves an unresolved placeholder in place when params are missing (never fabricates)', () => {
		expect(describeAbsence('closed-opens-at', 'en').why).toBe(
			'service is closed, opens at {first}',
		);
	});

	it('falls back to the generic not-reported copy for an unknown key (never renders a raw key)', () => {
		const d = describeAbsence('totally-made-up' as AbsenceReasonKey, 'en');
		expect(d.label).toBe('Unknown');
		expect(d.why).toBe('not reported in the live feed');
	});
});

describe('fieldAbsenceReason — thin per-field inferrer', () => {
	it('a stale entity is not-reporting', () => {
		expect(fieldAbsenceReason({ stale: true })).toBe('not-reporting');
	});
	it('a present entity with a missing field is not-reported', () => {
		expect(fieldAbsenceReason({ stale: false })).toBe('not-reported');
		expect(fieldAbsenceReason({})).toBe('not-reported');
	});
});
