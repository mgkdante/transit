import type { LivePresentation, StampPresentation } from '../livePresentation';
export function stampFixture(overrides: Partial<StampPresentation> = {}): StampPresentation {
	return {
		generatedUtc: '2026-06-15T00:00:00Z',
		ageSeconds: 12,
		ageSource: 'publication',
		ageText: '12 seconds ago',
		isStale: false,
		degraded: false,
		visible: true,
		...overrides,
	};
}
export function presentationFixture(overrides: Partial<LivePresentation> = {}): LivePresentation {
	return {
		stamp: stampFixture({ label: 'Latest report' }),
		publicationUtc: '2026-06-15T00:00:00Z',
		networkFeedAgeText: null,
		bannerState: 'idle',
		isPartialStale: false,
		notice: { kind: 'none', message: '', body: '', tone: 'neutral' },
		...overrides,
	};
}
