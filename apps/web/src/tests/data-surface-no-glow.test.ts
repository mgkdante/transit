import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf-8');

describe('flat data-surface contract', () => {
	it('keeps terminal and shared card chassis free of decorative outer glows', () => {
		const terminal = read('src/lib/components/brand/TerminalPanel.svelte');
		const card = read('src/lib/components/ui/card/card.svelte');

		expect(terminal).not.toContain('use:cursorGlow');
		expect(terminal).not.toMatch(/box-shadow:\s*var\(--shadow-(?:section|card|glow)/);
		expect(card).not.toMatch(/var\(--shadow-(?:section|card|glow)/);
	});

	it('keeps network and reliability data cards flat', () => {
		const networkTile = read('src/lib/features/network/reliability/sections/NetworkTile.svelte');
		const reliabilityPane = read('src/lib/components/surface/ReliabilityPane.svelte');
		const explainedMetric = read('src/lib/components/dataviz/ExplainedMetricCard.svelte');
		const informationCard = read('src/lib/components/shared/TypedInformationCard.svelte');

		expect(networkTile).not.toMatch(/box-shadow:/);
		expect(reliabilityPane).not.toMatch(/box-shadow:/);
		expect(explainedMetric).not.toMatch(/box-shadow:/);
		expect(informationCard).not.toMatch(/box-shadow:/);
	});

	it('keeps Data Health dashboard records and coverage tables free of the glowing card token', () => {
		const envelope = read('src/lib/features/health/sections/SectionEnvelope.svelte');
		const historyCoverage = read('src/lib/features/health/sections/SectionHistoryCoverage.svelte');

		expect(envelope).not.toContain('var(--shadow-card)');
		expect(historyCoverage).not.toContain('var(--shadow-card)');
	});

	it('keeps shared loading, empty, and error edge states flat', () => {
		const edgeState = read('src/lib/components/edge/EdgeState.svelte');

		expect(edgeState).not.toMatch(/\bshadow-(?:card|section|glow(?:-[\w-]+)?)\b/);
		expect(edgeState).not.toMatch(/box-shadow:\s*var\(--shadow-(?:card|section|glow)/);
	});

	it('uses solid control state without halo or drop-shadow decoration', () => {
		const grainPicker = read('src/lib/components/surface/GrainPicker.svelte');
		const toc = read('src/lib/components/shared/TocNav.svelte');
		const quietMode = read('src/lib/components/shared/QuietModeButton.svelte');
		const freshnessStamp = read('src/lib/components/surface/FreshnessStamp.svelte');

		expect(grainPicker).not.toContain('var(--shadow-glow-sm)');
		expect(toc).not.toMatch(/\.toc-counter-dot\s*\{[^}]*box-shadow:/s);
		expect(quietMode).not.toMatch(/filter:\s*drop-shadow/);
		expect(freshnessStamp).not.toMatch(/<StatusDot[^>]*\bpulse(?:=|\s|\/>)/s);
	});
});
