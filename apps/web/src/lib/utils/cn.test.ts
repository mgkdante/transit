import type { ClassValue } from 'clsx';
import { describe, expect, it } from 'vitest';
import { cn } from './cn';
import { TRANSIT_VOCAB } from './cn-vocab';
import { createCn } from './create-cn';

const LEGACY_OUTPUT_FIXTURES: Array<{
	label: string;
	inputs: ClassValue[];
	output: string;
}> = [
	{
		label: 'standard Tailwind conflicts',
		inputs: ['px-2', 'px-4'],
		output: 'px-4',
	},
	{
		label: 'clsx flattening and conditional classes',
		inputs: ['px-2', false, null, undefined, ['px-4'], { block: true }],
		output: 'px-4 block',
	},
	{
		label: 'brand text-scale conflicts',
		inputs: ['text-body', 'text-caption'],
		output: 'text-caption',
	},
	{
		label: 'brand text scale and color coexist',
		inputs: ['text-signage-bg', 'text-body'],
		output: 'text-signage-bg text-body',
	},
	{
		label: 'brand text-scale and color conflicts stay independent',
		inputs: ['text-body', 'text-caption', 'text-signage-text', 'text-accent-text'],
		output: 'text-caption text-accent-text',
	},
	{
		label: 'Transit status colors conflict',
		inputs: ['text-dataviz-status-late', 'text-dataviz-status-on-time'],
		output: 'text-dataviz-status-on-time',
	},
	{
		label: 'Transit heatmap backgrounds conflict',
		inputs: ['bg-dataviz-heatmap-3', 'bg-dataviz-heatmap-4'],
		output: 'bg-dataviz-heatmap-4',
	},
];

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
	for (const fixture of LEGACY_OUTPUT_FIXTURES) {
		it(`preserves ${fixture.label}`, () => {
			expect(cn(...fixture.inputs)).toBe(fixture.output);
		});
	}

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

describe('createCn', () => {
	it('includes the shared brand vocabulary without an app preset', () => {
		const baseCn = createCn();

		expect(baseCn('text-body text-caption')).toBe('text-caption');
		expect(baseCn('text-signage-bg text-body')).toBe('text-signage-bg text-body');
		expect(baseCn('text-signage-text text-accent-text')).toBe('text-accent-text');
	});

	it('adds third-consumer text and color vocabulary without app conditionals', () => {
		const consumerCn = createCn({
			text: ['consumer-label'],
			colors: ['consumer-accent'],
		});

		expect(consumerCn('text-body text-consumer-label')).toBe('text-consumer-label');
		expect(consumerCn('text-consumer-accent text-consumer-label')).toBe(
			'text-consumer-accent text-consumer-label',
		);
		expect(consumerCn('text-signage-text text-consumer-accent')).toBe('text-consumer-accent');
	});
});
