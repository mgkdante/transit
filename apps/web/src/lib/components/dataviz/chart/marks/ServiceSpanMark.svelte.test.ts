import { render, waitFor, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServiceSpanMark from './ServiceSpanMark.svelte';
import type { ServiceSpanSpec } from '../ChartSpec';
import { reliabilityCopy } from '$lib/features/lines/reliability/reliability.copy';

function example(locale: 'en' | 'fr'): ServiceSpanSpec {
	const copy = reliabilityCopy[locale].serviceSpanTimeline;
	const [firstClock, lastClock] =
		locale === 'en'
			? ['Jun 26, 2026, 06:00:00 GMT-4', 'Jun 27, 2026, 07:00:00 GMT-4']
			: ['26 juin 2026, 06 h 00 min 00 s UTC−4', '27 juin 2026, 07 h 00 min 00 s UTC−4'];
	return {
		kind: 'service-span',
		locale,
		title: copy.ariaLabel(firstClock, lastClock),
		domain: [0, 1800],
		elapsedMin: 1500,
		firstClock,
		lastClock,
		firstLabel: copy.firstTrip,
		lastLabel: copy.lastTrip,
		firstDelayMin: null,
		lastDelayMin: 2,
		firstDelayLabel: copy.firstDelay,
		lastDelayLabel: copy.lastDelay,
		noDataLabel: locale === 'en' ? 'No data' : 'Aucune donnée',
		spanLabel: copy.span('25 h'),
		tripsLabel: copy.trips('2'),
		hourTicks: [0, 720, 1440, 1800].map((min) => ({ min, label: `+${min / 60}h` })),
	};
}

function mount(spec: ServiceSpanSpec) {
	// Supply DOM dimensions; the real LayerChart context and scales still render the SVG.
	vi.stubGlobal('IntersectionObserver', undefined);
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(90);
	return render(ServiceSpanMark, { props: { spec } });
}

const number = (element: Element, name: string) => Number(element.getAttribute(name));
async function track(container: HTMLElement) {
	return waitFor(() => {
		const element = container.querySelector('line.dv-span-track');
		expect(element).not.toBeNull();
		expect(number(element!, 'x2') - number(element!, 'x1')).toBeGreaterThan(0);
		return element!;
	});
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('ServiceSpanMark elapsed first-report interval', () => {
	it.each(['en', 'fr'] as const)(
		'renders complete endpoint labels and a 25/30-hour interval in %s',
		async (locale) => {
			const spec = example(locale);
			const { container } = mount(spec);
			const baseline = await track(container);
			const width = number(baseline, 'x2') - number(baseline, 'x1');
			const bar = container.querySelector('rect.dv-span-bar')!;
			expect(number(bar, 'x')).toBe(number(baseline, 'x1'));
			expect(number(bar, 'width') / width).toBeCloseTo(25 / 30, 8);
			expect(
				[...container.querySelectorAll('.dv-span-end-clock')].map((node) => node.textContent),
			).toEqual([spec.firstClock, spec.lastClock]);
			expect(container.querySelector('figure')).toHaveAttribute('aria-label', spec.title);
			expect(container.querySelector('[data-slot="span-length"]')).toHaveTextContent('25 h');
			expect(container.querySelector('[data-slot="span-trips"]')).toHaveTextContent('2');
			expect(container.querySelector('[data-slot="span-delay"][data-end="first"]')).toHaveAttribute(
				'aria-label',
				`${spec.firstDelayLabel}: ${spec.noDataLabel}`,
			);
			expect(container.querySelector('[data-slot="span-delay"][data-end="last"]')).toHaveAttribute(
				'aria-label',
				`${spec.lastDelayLabel}: +2 min`,
			);
			expect.soft(spec.firstLabel).toMatch(locale === 'en' ? /first report/i : /premier relevé/i);
			expect
				.soft(spec.lastDelayLabel)
				.toMatch(locale === 'en' ? /latest report/ : /dernier relevé/);
			expect
				.soft(reliabilityCopy[locale].serviceSpanTimeline.caption)
				.not.toMatch(/departure clock|journée de 24 h|du départ/);
		},
	);

	it('keeps zero as a point and a positive subminute interval at its exact scale width', async () => {
		const original = example('en');
		const zero = {
			...original,
			elapsedMin: 0,
			lastClock: original.firstClock,
			spanLabel: null,
			tripsLabel: null,
		};
		const view = mount(zero);
		const baseline = await track(view.container);
		expect(view.container.querySelector('rect.dv-span-bar')).toBeNull();
		expect(view.container.querySelectorAll('circle.dv-span-dot')).toHaveLength(1);
		expect(number(view.container.querySelector('circle.dv-span-dot')!, 'cx')).toBe(
			number(baseline, 'x1'),
		);
		expect(view.container.querySelector('.dv-span-annot')).toBeNull();
		await view.rerender({
			spec: { ...zero, elapsedMin: 0.25, lastClock: 'Jun 26, 2026, 06:00:15 GMT-4' },
		});
		const bar = view.container.querySelector('rect.dv-span-bar')!;
		const width = number(baseline, 'x2') - number(baseline, 'x1');
		expect(number(bar, 'width') / width).toBeCloseTo(0.25 / 1800, 10);
		expect(number(bar, 'width')).toBeLessThan(2);
		expect(view.container.querySelectorAll('circle.dv-span-dot')).toHaveLength(2);
	});
});
