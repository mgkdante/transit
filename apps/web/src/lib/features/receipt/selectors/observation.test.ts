import { describe, expect, it } from 'vitest';
import type { IsoUtc, Manifest, Receipt, ReceiptsIndex } from '$lib/v1/schemas';
import { receiptObservation } from './observation';

const receipt: Receipt = {
	date: '2026-06-17',
	generated_utc: '2026-06-18T07:00:00Z' as IsoUtc,
	otp_pct: 0,
	avg_delay_min: 3.4,
	severe_pct: null,
	publish_generation_id: 'generation-a',
	methodology_version: 'reliability-2',
};
const index: ReceiptsIndex = {
	generated_utc: receipt.generated_utc,
	dates: ['2026-06-15', receipt.date],
	available: [{ date: receipt.date, has_data: true, has_schedule: false }],
};
const manifest = {
	provider: 'stm',
	display_name: 'Société de transport de Montréal',
	tz: 'America/Toronto',
	files: { historic: { receipts_prefix: 'historic/receipts/' } },
} as Manifest;

describe('receipt observation text', () => {
	it.each(['en', 'fr'] as const)(
		'retains actual source, date, units, generation and coverage in %s',
		(locale) => {
			const text = receiptObservation(receipt, index, manifest, locale, 'https://transit.example');
			expect(text).toContain('Société de transport de Montréal (stm)');
			expect(text).toContain(
				`${locale === 'fr' ? 'Date locale des observations' : 'Local observation date'}: 2026-06-17 (America/Toronto)`,
			);
			expect(text).toContain('0%');
			expect(text).toContain('3.4 min');
			expect(text).toContain('2026-06-18T07:00:00Z');
			expect(text).toContain('generation-a');
			expect(text).toContain('reliability-2');
			expect(text).toContain('2026-06-15 – 2026-06-17');
			expect(text).toContain(
				'https://transit.example/data/v1/stm/historic/receipts/2026-06-17.json',
			);
			expect(text).toContain(`${locale === 'fr' ? '/fr' : ''}/receipt?date=2026-06-17`);
			expect(text.match(/https:\/\/transit.example\/(?:fr\/)?metrics#/g)).toHaveLength(3);
			expect(text).toContain(
				locale === 'fr' ? 'Une valeur absente est inconnue' : 'A missing figure is unknown',
			);
			expect(text).toContain(
				locale === 'fr' ? 'Données d’horaire publiées: non' : 'Schedule data published: no',
			);
		},
	);

	it('keeps missing coverage and generation unknown without inferring a daily denominator from shifts', () => {
		const text = receiptObservation(
			{
				...receipt,
				publish_generation_id: null,
				methodology_version: null,
				by_shift: [{ shift: 'pm_peak', observation_count: 120 }],
			},
			{ generated_utc: receipt.generated_utc },
			manifest,
			'en',
			'https://transit.example',
		);
		expect(text).toContain('Severe delays: not reported');
		expect(text).toContain('Reliability data published: not reported');
		expect(text).not.toContain('Publication generation:');
		expect(text).not.toContain('120');
		expect(text).not.toContain('Published receipt dates');
	});
});
