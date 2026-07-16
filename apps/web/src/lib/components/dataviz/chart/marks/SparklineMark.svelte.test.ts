import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { SparklineSpec } from '../ChartSpec';
import SparklineMark from './SparklineMark.svelte';

const fluidSpec = {
	kind: 'sparkline',
	title: 'Vehicles reporting',
	locale: 'en',
	domain: [0, 20],
	unit: '',
	label: 'Vehicles',
	values: [9, 11],
	width: '100%',
	height: 56,
} satisfies SparklineSpec;

describe('SparklineMark responsive width', () => {
	it('fills and stays within its available row when the spec requests fluid width', () => {
		const { container } = render(SparklineMark, { props: { spec: fluidSpec } });
		const figure = container.querySelector<HTMLElement>('[data-slot="sparkline-mark"]');
		const plot = container.querySelector<HTMLElement>('.dv-sparkline-plot');

		expect(figure?.style.width).toBe('100%');
		expect(figure?.style.maxWidth).toBe('100%');
		expect(plot?.style.width).toBe('100%');
		expect(plot?.style.maxWidth).toBe('100%');
	});
});
