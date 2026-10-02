import { describe, it, expect } from 'vitest';
import { selectHeadlineKpis } from './headlineKpis';

const labels = {
	onTime: 'On-time',
	avgDelay: 'Average delay',
	severe: 'Severe delays',
	fmtPct: (v: number | null | undefined) => (v == null ? null : `${v}%`),
	fmtMin: (v: number | null | undefined) => (v == null ? null : `${v} min`),
	fmtSeverePct: (v: number | null | undefined) => (v == null ? null : `${v.toFixed(1)}%`),
};

describe('selectHeadlineKpis', () => {
	it('builds the three reliability KPIs without promoting the legacy impact score', () => {
		const receipt = { otp_pct: 82, avg_delay_min: 3.4, severe_pct: 4.2, rider_impact_score: 7.2 };
		const vms = selectHeadlineKpis(receipt, labels);
		expect(vms.map((v) => v.key)).toEqual(['otp', 'avgDelay', 'severe']);
		expect(vms[0].value).toBe('82%');
		expect(vms[2].value).toBe('4.2%');
		expect(vms[0].size).toBe('lg');
		expect(vms[2].size).toBe('md');
	});

	it('renders null (honest-absence chip) for a null reading, never a fabricated 0', () => {
		const vms = selectHeadlineKpis(
			{ otp_pct: null, avg_delay_min: null, severe_pct: null },
			labels,
		);
		for (const v of vms) expect(v.value).toBeNull();
	});

	it('keeps a real measured 0 as a real 0', () => {
		const vms = selectHeadlineKpis({ otp_pct: 0, avg_delay_min: 0, severe_pct: 0 }, labels);
		expect(vms[0].value).toBe('0%');
		expect(vms[1].value).toBe('0 min');
	});
});
