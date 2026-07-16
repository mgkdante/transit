import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const consumers = [
	{
		name: 'Hotspots',
		file: 'src/lib/features/hotspots/HotspotsBoard.svelte',
		storageKey: "controls: 'hotspots-controls'",
		controllerKey: 'controls',
		title: 'title={t.rail.controls}',
	},
	{
		name: 'Line reliability',
		file: 'src/lib/features/lines/reliability/RouteReliabilityClusters.svelte',
		storageKey: "controls: 'reliability-controls'",
		controllerKey: 'controls',
		title: 'title={copy.controls.viewLabel}',
	},
	{
		name: 'Stop reliability',
		file: 'src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte',
		storageKey: "controls: 'stop-reliability-controls'",
		controllerKey: 'controls',
		title: 'title={copy.controlsLabel}',
	},
	{
		name: 'Network',
		file: 'src/lib/features/network/reliability/sections/NetworkSurface.svelte',
		storageKey: "controls: 'network-controls'",
		controllerKey: 'controls',
		title: 'title={t.viewControlsLabel}',
	},
	{
		name: 'Repeat offenders',
		file: 'src/lib/features/repeat-offenders/RepeatOffenders.svelte',
		storageKey: "controls: 'repeat-offenders-controls'",
		controllerKey: 'controls',
		title: 'title={t.rail.controls}',
	},
	{
		name: 'Alerts',
		file: 'src/lib/features/alerts/AlertHistory.svelte',
		storageKey: "filters: 'alerts-filters'",
		controllerKey: 'filters',
		title: 'title={t.filters.railLabel}',
	},
] as const;

const labelFreeConsumers = [
	{
		file: 'src/lib/features/lines/reliability/RouteReliabilityClusters.svelte',
		className: 'reliability-rail-view',
	},
	{
		file: 'src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte',
		className: 'stop-reliability-view',
	},
	{
		file: 'src/lib/features/network/reliability/sections/NetworkSurface.svelte',
		className: 'network-rail-view',
	},
] as const;

const immutableListings = [
	{
		file: 'src/lib/features/lines/LinesIndex.svelte',
		// Inventory unknowns now receive localized assistive text; listing controls
		// and visible layout remain unchanged.
		sha256: 'dd3a8b941c5409b7a6bee228f4edd6f4367942217d141a7a708ac5400db24c96',
	},
	{
		file: 'src/lib/features/stops/StopsIndex.svelte',
		// The approved site-wide no-data slice changed the empty renderer and added
		// localized assistive inventory/mode text; controls remain immutable.
		sha256: 'fe5bb565bbb6024c37b6c7d258cb61bf3f993ba9b88f9fba6eaaf77ba8186f22',
	},
] as const;

function source(file: string): string {
	return readFileSync(resolve(process.cwd(), file), 'utf-8');
}

describe('article control disclosure consumer contract', () => {
	it.each(consumers)('$name uses the one shared disclosure before its ToC', (consumer) => {
		const component = source(consumer.file);
		const disclosureIndex = component.indexOf('<ArticleControlDisclosure');
		const tocIndex = component.indexOf('data-slot="section-toc"');

		expect(component, consumer.file).toMatch(
			/import\s*\{[\s\S]*?\bArticleControlDisclosure\b[\s\S]*?\}\s*from\s*['"]\$lib\/components\/surface['"]/,
		);
		expect(disclosureIndex, consumer.file).toBeGreaterThanOrEqual(0);
		expect(component, consumer.file).toContain(consumer.title);
		expect(component, consumer.file).toContain(consumer.storageKey);
		expect(component, consumer.file).toContain(
			`railDisclosures.isOpen('${consumer.controllerKey}')`,
		);
		expect(component, consumer.file).toContain(
			`railDisclosures.set('${consumer.controllerKey}', next)`,
		);
		expect(component, consumer.file).not.toContain('data-slot="controls-body"');
		expect(tocIndex, consumer.file).toBeGreaterThan(disclosureIndex);
	});

	it.each(labelFreeConsumers)('$file removes the redundant in-body control label', (consumer) => {
		const component = source(consumer.file);
		const stackTag = component.match(/<ArticleControlStack[\s\S]*?\/>/)?.[0] ?? '';

		expect(component).not.toContain('data-slot="controls-rail-label"');
		expect(component).not.toContain(consumer.className);
		expect(component).not.toMatch(/{#snippet controlLabel\(\)}/);
		expect(stackTag).not.toContain('label=');
	});

	it('does not render an empty Network disclosure when no view control is available', () => {
		const component = source('src/lib/features/network/reliability/sections/NetworkSurface.svelte');

		expect(component).toMatch(
			/const hasViewControls = \$derived\(\s*history\.index != null \|\| showGrainPicker \|\| showSecondaryControls,?\s*\);/,
		);
		expect(component).toMatch(
			/{#if hasViewControls}\s*<ArticleControlDisclosure[\s\S]*?<ArticleControlStack[\s\S]*?<\/ArticleControlDisclosure>\s*{\/if}/,
		);
	});

	it.each(immutableListings)('leaves $file byte-for-byte untouched', (listing) => {
		const digest = createHash('sha256').update(source(listing.file)).digest('hex');
		expect(digest).toBe(listing.sha256);
	});
});
