import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf-8');

describe('flat data-surface contract', () => {
	it('keeps the terminal chassis free of decorative outer glows', () => {
		const terminal = read('src/lib/components/brand/TerminalPanel.svelte');

		expect(terminal).not.toContain('use:cursorGlow');
		expect(terminal).not.toMatch(/box-shadow:\s*var\(--shadow-(?:section|card|glow)/);
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

	it('keeps shared loading, empty, and error edge states flat', () => {
		const edgeState = read('src/lib/components/edge/EdgeState.svelte');

		expect(edgeState).not.toMatch(/\bshadow-(?:card|section|glow(?:-[\w-]+)?)\b/);
		expect(edgeState).not.toMatch(/box-shadow:\s*var\(--shadow-(?:card|section|glow)/);
	});

	it('uses solid control state without halo or drop-shadow decoration', () => {
		const grainPicker = read('src/lib/components/surface/GrainPicker.svelte');
		const freshnessStamp = read('src/lib/components/surface/FreshnessStamp.svelte');

		expect(grainPicker).not.toContain('var(--shadow-glow-sm)');
		expect(freshnessStamp).not.toMatch(/<StatusDot[^>]*\bpulse(?:=|\s|\/>)/s);
	});
});
