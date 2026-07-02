import { describe, it, expect } from 'vitest';
import { selectHeadlineKpis } from './headlineKpis';

const labels = {
	onTime: 'On-time',
	avgDelay: 'Average delay',
	severe: 'Severe delays',
	riderImpact: 'Rider impact',
	fmtPct: (v: number | null | undefined) => (v == null ? null : `${v}%`),
	fmtMin: (v: number | null | undefined) => (v == null ? null : `${v} min`),
	fmtSeverePct: (v: number | null | undefined) => (v == null ? null : `${v.toFixed(1)}%`),
	fmtScore: (v: number | null | undefined) => (v == null ? null : v.toFixed(1)),
};

describe('selectHeadlineKpis', () => {
	it('builds the four KPI VMs with formatted displays', () => {
		const vms = selectHeadlineKpis(
			{ otp_pct: 82, avg_delay_min: 3.4, severe_pct: 4.2, rider_impact_score: 7.2 },
			labels,
		);
		expect(vms.map((v) => v.key)).toEqual(['otp', 'avgDelay', 'severe', 'riderImpact']);
		expect(vms[0].value).toBe('82%');
		expect(vms[2].value).toBe('4.2%');
		expect(vms[3].value).toBe('7.2');
		expect(vms[0].size).toBe('lg');
		expect(vms[2].size).toBe('md');
	});

	it('renders null (honest-absence chip) for a null reading, never a fabricated 0', () => {
		const vms = selectHeadlineKpis(
			{ otp_pct: null, avg_delay_min: null, severe_pct: null, rider_impact_score: null },
			labels,
		);
		for (const v of vms) expect(v.value).toBeNull();
	});

	it('keeps a real measured 0 as a real 0', () => {
		const vms = selectHeadlineKpis(
			{ otp_pct: 0, avg_delay_min: 0, severe_pct: 0, rider_impact_score: 0 },
			labels,
		);
		expect(vms[0].value).toBe('0%');
		expect(vms[1].value).toBe('0 min');
	});
});
