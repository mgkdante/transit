import { describe, expect, it } from 'vitest';
import {
	historyPointArtifactPayloadSha,
	isHistoryFamilyIndexPath,
	isHistoryPointArtifactPath,
	type RetainedRangeHistoryFamily,
} from './pointers';

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

describe('retained-history pointer allowlists', () => {
	it('keeps fixed and exact versioned indexes for range families only', () => {
		for (const family of ['network', 'lines', 'stops'] satisfies RetainedRangeHistoryFamily[]) {
			expect(isHistoryFamilyIndexPath(family, `historic/history/${family}/index.json`)).toBe(true);
			expect(
				isHistoryFamilyIndexPath(
					family,
					`historic/history/${family}/generations/${SHA}/index.json`,
				),
			).toBe(true);
		}
	});

	it('allows point-family indexes only at exact immutable versioned paths', () => {
		for (const family of ['hotspots', 'repeat_offenders'] as const) {
			const versioned = `historic/history/${family}/generations/${SHA}/index.json`;
			expect(isHistoryFamilyIndexPath(family, versioned)).toBe(true);
			expect(isHistoryFamilyIndexPath(family, `historic/history/${family}/index.json`)).toBe(false);

			for (const unsafe of [
				`historic/history/network/generations/${SHA}/index.json`,
				`historic/history/${family}/generations/${SHA.toUpperCase()}/index.json`,
				`historic/history/${family}/generations/abc/index.json`,
				`${versioned}?raw=1`,
				`${versioned}#fragment`,
				`historic/history/${family}/../network/generations/${SHA}/index.json`,
				`historic/history/${family}/%2e%2e/network/generations/${SHA}/index.json`,
				`historic/history/${family}/generations/${SHA}/extra/index.json`,
				`historic\\history\\${family}\\generations\\${SHA}\\index.json`,
				`/historic/history/${family}/generations/${SHA}/index.json`,
				`https://evil.test/historic/history/${family}/generations/${SHA}/index.json`,
			]) {
				expect(isHistoryFamilyIndexPath(family, unsafe)).toBe(false);
			}
		}
	});

	it('requires exact point-family, payload SHA, and canonical date artifact paths', () => {
		for (const family of ['hotspots', 'repeat_offenders'] as const) {
			const date = '2026-07-13';
			const exact = `historic/history/${family}/generations/${SHA}/${date}.json`;
			expect(isHistoryPointArtifactPath(family, date, exact)).toBe(true);
			expect(historyPointArtifactPayloadSha(family, date, exact)).toBe(SHA);

			for (const unsafe of [
				`historic/history/${family}/generations/${OTHER_SHA}/2026-07-12.json`,
				`historic/history/${family === 'hotspots' ? 'repeat_offenders' : 'hotspots'}/generations/${SHA}/${date}.json`,
				`historic/history/${family}/generations/${SHA.toUpperCase()}/${date}.json`,
				`historic/history/${family}/generations/abc/${date}.json`,
				`historic/history/${family}/generations/${SHA}/0000-01-01.json`,
				`historic/history/${family}/generations/${SHA}/2026-02-30.json`,
				`historic/history/${family}/generations/${SHA}/../${date}.json`,
				`historic/history/${family}/generations/${SHA}/%2e%2e/${date}.json`,
				`historic/history/${family}/generations/${SHA}/extra/${date}.json`,
				`historic\\history\\${family}\\generations\\${SHA}\\${date}.json`,
				`/${exact}`,
				`https://evil.test/${exact}`,
				`${exact}?raw=1`,
				`${exact}#fragment`,
			]) {
				expect(isHistoryPointArtifactPath(family, date, unsafe)).toBe(false);
				expect(historyPointArtifactPayloadSha(family, date, unsafe)).toBeNull();
			}
			expect(
				isHistoryPointArtifactPath(
					family,
					'0000-01-01',
					`historic/history/${family}/generations/${SHA}/0000-01-01.json`,
				),
			).toBe(false);
		}
	});
});
