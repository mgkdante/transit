import { describe, expect, it, vi } from 'vitest';
import { cn as uiCn } from '@yesid/ui/cn';
import { configureTransitUi } from '$lib/ui/configure';
import { cn } from '$lib/ui/configure';
import { TRANSIT_VOCAB } from './cn-vocab';

const LEGACY_TRANSIT_DATAVIZ_COLORS = [
	'dataviz-status-early',
	'dataviz-status-on-time',
	'dataviz-status-late',
	'dataviz-status-severe',
	'dataviz-status-unknown',
	'dataviz-occupancy-empty',
	'dataviz-occupancy-many-seats',
	'dataviz-occupancy-few-seats',
	'dataviz-occupancy-standing',
	'dataviz-occupancy-full',
	'dataviz-severity-critical',
	'dataviz-severity-high',
	'dataviz-severity-watch',
	'dataviz-heatmap-0',
	'dataviz-heatmap-1',
	'dataviz-heatmap-2',
	'dataviz-heatmap-3',
	'dataviz-heatmap-4',
	'dataviz-heatmap-nodata',
	'dataviz-vehicle-on-time',
	'dataviz-vehicle-delayed',
	'dataviz-vehicle-cancelled',
	'dataviz-vehicle-no-data',
] as const;

describe('cn legacy behavior', () => {
	it('classifies every Transit dataviz token as a color', () => {
		expect(TRANSIT_VOCAB.colors).toEqual(LEGACY_TRANSIT_DATAVIZ_COLORS);

		for (const [index, color] of TRANSIT_VOCAB.colors.entries()) {
			const nextColor = TRANSIT_VOCAB.colors[(index + 1) % TRANSIT_VOCAB.colors.length];

			expect(cn(`text-body text-${color}`)).toBe(`text-body text-${color}`);
			expect(cn(`text-${color} text-body`)).toBe(`text-${color} text-body`);
			expect(cn(`text-${color} text-${nextColor}`)).toBe(`text-${nextColor}`);
		}
	});
});

describe('configureTransitUi', () => {
	it('teaches package components the Transit dataviz color vocabulary', () => {
		configureTransitUi();

		expect(uiCn('text-dataviz-status-late text-dataviz-status-on-time')).toBe(
			'text-dataviz-status-on-time',
		);
	});
});

describe('app cn configuration ownership', () => {
	async function freshMergers() {
		vi.resetModules();
		const app = await import('$lib/ui/configure');
		const ui = await import('@yesid/ui/cn');
		const { configureTransitUi: configure } = await import('$lib/ui/configure');
		return { app, ui, configure };
	}

	const classes = ['text-body', 'text-dataviz-status-late', 'text-dataviz-status-on-time'];
	const merged = 'text-body text-dataviz-status-on-time';

	it('does not configure the package when the app helper is only imported', async () => {
		const { ui } = await freshMergers();
		expect(ui.configureUi({ vocab: { colors: ['independent-consumer'] } })).toBe('initialized');
	});

	it('keeps standalone app calls isolated from package configuration', async () => {
		const { app, ui } = await freshMergers();
		expect(app.cn(...classes)).toBe(merged);
		expect(ui.configureUi({ vocab: { colors: ['independent-consumer'] } })).toBe('initialized');
		expect(app.cn(...classes)).toBe(merged);
	});

	it.each(['default', 'foreign'] as const)(
		'preserves standalone output and C1 rejection with an existing %s package configuration',
		async (kind) => {
			const { app, ui, configure } = await freshMergers();
			if (kind === 'default') ui.cn('text-body');
			else ui.configureUi({ vocab: { colors: ['independent-consumer'] } });
			expect(app.cn(...classes)).toBe(merged);
			expect(configure).toThrow('different configuration');
			expect(app.cn(...classes)).toBe(merged);
			expect(configure).toThrow('different configuration');
		},
	);

	it('switches from isolated calls to the public merger only after explicit successful boot', async () => {
		const { app, ui, configure } = await freshMergers();
		const shared = vi.spyOn(ui, 'cn');
		expect(app.cn(...classes)).toBe(merged);
		expect(shared).not.toHaveBeenCalled();
		configure();
		expect(app.cn(...classes)).toBe(merged);
		expect(shared).toHaveBeenCalledExactlyOnceWith(...classes);
		configure();
		expect(app.cn('px-2', 'px-4')).toBe('px-4');
		expect(shared).toHaveBeenCalledTimes(2);
		expect(ui.configureUi({ vocab: TRANSIT_VOCAB })).toBe('unchanged');
	});

	it('reuses the public merger when bootstrap happens before the first app call', async () => {
		const { app, ui, configure } = await freshMergers();
		configure();
		const shared = vi.spyOn(ui, 'cn');
		expect(app.cn(...classes)).toBe(merged);
		expect(shared).toHaveBeenCalledExactlyOnceWith(...classes);
	});
});
