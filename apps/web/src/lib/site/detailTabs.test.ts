import { describe, expect, it } from 'vitest';
import { canonicalDetailTabLocation, detailTabFromSearchParams } from './detailTabs';

describe('detail tab URL contract', () => {
	it.each([
		['', 'detail'],
		['?tab=detail', 'detail'],
		['?tab=next', 'detail'],
		['?tab=schedule', 'schedule'],
		['?tab=reliability', 'reliability'],
	] as const)('reads %s as %s', (search, expected) => {
		expect(detailTabFromSearchParams(new URLSearchParams(search))).toBe(expected);
	});

	it.each(['', '?tab=schedule', '?tab=reliability'])('accepts the canonical query %s', (search) => {
		expect(
			canonicalDetailTabLocation(new URL(`https://transit.yesid.dev/fr/lines/24${search}`)),
		).toBeNull();
	});

	it('drops a default, legacy or unknown tab and preserves the locale path and other params', () => {
		expect(
			canonicalDetailTabLocation(
				new URL(
					'https://transit.yesid.dev/fr/stop/57191?from=2026-01-31&tab=info&to=2026-02-01&line=51',
				),
			),
		).toBe('/fr/stop/57191?from=2026-01-31&to=2026-02-01&line=51');
	});

	it('reduces duplicate tab params to the first selected canonical view', () => {
		expect(
			canonicalDetailTabLocation(
				new URL('https://transit.yesid.dev/lines/24?tab=schedule&tab=unknown&from=2026-01-31'),
			),
		).toBe('/lines/24?from=2026-01-31&tab=schedule');
	});
});
