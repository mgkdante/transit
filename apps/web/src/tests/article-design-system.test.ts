import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf-8');

const articleCompositions = [
	{
		path: 'src/lib/features/hotspots/HotspotsBoard.svelte',
		slot: 'hotspots-sections',
		legacyClass: 'hotspots-sections',
	},
	{
		path: 'src/lib/features/receipt/AccountabilityReceipt.svelte',
		slot: 'receipt-sections',
		legacyClass: 'receipt-sections',
	},
	{
		path: 'src/lib/features/repeat-offenders/RepeatOffenders.svelte',
		slot: 'repeat-offenders-sections',
		legacyClass: 'repeat-offenders-sections',
	},
	{
		path: 'src/lib/features/alerts/AlertHistory.svelte',
		slot: 'alert-sections',
		legacyClass: 'alert-history-sections',
	},
] as const;

const articleControlPages = [
	'src/lib/features/lines/RouteDetail.svelte',
	'src/lib/features/stops/StopDetail.svelte',
	'src/lib/features/health/HealthStatus.svelte',
	'src/lib/features/metrics/MetricsExplainer.svelte',
	'src/lib/features/hotspots/HotspotsBoard.svelte',
	'src/lib/features/receipt/AccountabilityReceipt.svelte',
	'src/lib/features/repeat-offenders/RepeatOffenders.svelte',
	'src/lib/features/alerts/AlertHistory.svelte',
	'src/lib/features/network/reliability/sections/NetworkSurface.svelte',
] as const;

describe('article design-system composition', () => {
	it.each(articleCompositions)(
		'$path delegates primary card spacing to ArticleSectionStack',
		({ path, slot, legacyClass }) => {
			const page = source(path);

			expect(page).toMatch(
				/import\s*\{[^}]*ArticleSectionStack[^}]*\}\s*from\s*['"]\$lib\/components\/layout['"]/s,
			);
			expect(page).toMatch(new RegExp(`<ArticleSectionStack[^>]*data-slot=["']${slot}["']`));
			expect(page).not.toMatch(new RegExp(`\\.${legacyClass}\\s*\\{`));
		},
	);

	it('keeps the shared independent-card spacing and flat article title contract', () => {
		const stack = source('src/lib/components/layout/ArticleSectionStack.svelte');
		const header = source('src/lib/components/layout/ArticleHeader.svelte');

		expect(stack).toMatch(/\.article-section-stack\s*\{[^}]*gap:\s*var\(--space-card-gap\);/s);
		expect(stack).not.toMatch(/border-radius:\s*0|border-block-start-width:\s*0/);
		expect(header).not.toMatch(/text-shadow/);
	});

	it.each(articleControlPages)(
		'%s renders the shared Collapse/Remember control in the final centered header row',
		(path) => {
			const page = source(path);
			const controls = page.match(/\{#snippet controls\(\)\}([\s\S]*?)\{\/snippet\}/)?.[1] ?? '';
			const actions = page.match(/\{#snippet actions\(\)\}([\s\S]*?)\{\/snippet\}/)?.[1] ?? '';

			expect(controls).toContain('<QuietModeButton />');
			expect(actions).not.toContain('QuietModeButton');
		},
	);

	it('keeps the shared controls row after every other ArticleHeader content row', () => {
		const header = source('src/lib/components/layout/ArticleHeader.svelte');
		const actionsIndex = header.indexOf('data-slot="article-header-actions"');
		const controlsIndex = header.indexOf('data-slot="article-header-controls"');

		expect(controlsIndex).toBeGreaterThan(actionsIndex);
		expect(header).toMatch(/\.header__controls\s*\{[^}]*justify-content:\s*center/s);
	});
});
