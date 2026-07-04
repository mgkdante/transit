// SurfaceControls.svelte.test.ts — the seated grain/window rail primitive.
//
// Composes ControlsRail + GrainPicker, so the radiogroup contract is INHERITED
// (GrainPicker.svelte.test.ts owns the keyboard matrix). This gate covers the
// NEW behaviour the primitive adds on top: the data-depth availability clamp
// (usableFromOffered / MIN_POINTS floor), disable-never-hide with an honest
// absence reason (aria-describedby + title), the window/nav slots, and codec
// purity (no local $state / URL writes in the source).

import { render, within, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SurfaceControls from './SurfaceControls.svelte';
import type { Grain } from '$lib/v1/schemas';

const LABELS: Partial<Record<Grain, string>> = { day: 'Day', week: 'Week', month: 'Month' };
const OFFERED: readonly Grain[] = ['day', 'week', 'month'];

function renderControls(props: Record<string, unknown>) {
	return render(SurfaceControls, {
		props: {
			offered: OFFERED,
			availability: {},
			value: 'day' as Grain,
			labels: LABELS,
			grainLabel: 'Granularity',
			locale: 'en',
			...props,
		},
	});
}

describe('SurfaceControls — radiogroup composition', () => {
	it('renders the offered grains as radios inside a labelled radiogroup', () => {
		const { getByRole } = renderControls({
			availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 30 } },
		});
		const group = getByRole('radiogroup', { name: 'Granularity' });
		expect(within(group).getByRole('radio', { name: 'Day' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		expect(within(group).getAllByRole('radio')).toHaveLength(3);
	});

	it('round-trips bind:value (a click updates the bound grain)', async () => {
		let value: Grain = 'day';
		const { getByRole } = render(SurfaceControls, {
			props: {
				offered: OFFERED,
				availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 30 } },
				get value() {
					return value;
				},
				set value(v: Grain) {
					value = v;
				},
				labels: LABELS,
				grainLabel: 'Granularity',
				locale: 'en',
			},
		});
		await fireEvent.click(getByRole('radio', { name: 'Week' }));
		expect(value).toBe('week');
	});
});

describe('SurfaceControls — data-depth availability clamp', () => {
	it('enables every grain at or above minPoints', () => {
		const { getByRole } = renderControls({
			minPoints: 7,
			availability: { day: { buckets: 30 }, week: { buckets: 10 }, month: { buckets: 7 } },
		});
		expect(getByRole('radio', { name: 'Day' })).not.toBeDisabled();
		expect(getByRole('radio', { name: 'Week' })).not.toBeDisabled();
		expect(getByRole('radio', { name: 'Month' })).not.toBeDisabled();
	});

	it('DISABLES (never removes) a grain below minPoints and describes why', () => {
		const { getByRole } = renderControls({
			minPoints: 7,
			availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 3 } },
		});
		const month = getByRole('radio', { name: 'Month' });
		expect(month).toBeDisabled();
		// aria-describedby points at a description whose text is the honest reason.
		const descId = month.getAttribute('aria-describedby');
		expect(descId).toBeTruthy();
		const desc = document.getElementById(descId as string);
		expect(desc?.textContent).toBe('not enough readings yet');
		// The same reason rides the title for pointer users.
		expect(month).toHaveAttribute('title', 'not enough readings yet');
	});

	it('treats a grain absent from the availability map as 0 buckets (disabled)', () => {
		const { getByRole } = renderControls({
			minPoints: 7,
			availability: { day: { buckets: 30 }, week: { buckets: 30 } },
		});
		expect(getByRole('radio', { name: 'Month' })).toBeDisabled();
	});

	it('respects a custom absentReason override on the disabled reason', () => {
		const { getByRole } = renderControls({
			minPoints: 7,
			availability: { day: { buckets: 30 }, month: { buckets: 2, absentReason: 'not-reported' } },
		});
		const month = getByRole('radio', { name: 'Month' });
		// 'not-reported' EN copy: "not reported yet" (from absence.ts), not the default.
		expect(month.getAttribute('title')).not.toBe('not enough readings yet');
		expect(month.getAttribute('title')?.length).toBeGreaterThan(0);
	});

	it('honours a minPoints override (1 reproduces a length>0 gate)', () => {
		const { getByRole } = renderControls({
			minPoints: 1,
			availability: { day: { buckets: 5 }, week: { buckets: 1 }, month: { buckets: 0 } },
		});
		expect(getByRole('radio', { name: 'Day' })).not.toBeDisabled();
		expect(getByRole('radio', { name: 'Week' })).not.toBeDisabled();
		// 0 buckets → disabled even at minPoints=1.
		expect(getByRole('radio', { name: 'Month' })).toBeDisabled();
	});

	it('enables the boundary case buckets === minPoints (>= semantics)', () => {
		const { getByRole } = renderControls({
			minPoints: 7,
			availability: { day: { buckets: 7 }, week: { buckets: 6 }, month: { buckets: 7 } },
		});
		expect(getByRole('radio', { name: 'Day' })).not.toBeDisabled();
		expect(getByRole('radio', { name: 'Week' })).toBeDisabled();
		expect(getByRole('radio', { name: 'Month' })).not.toBeDisabled();
	});
});

describe('SurfaceControls — disable-never-hide', () => {
	it('keeps every offered grain in the DOM regardless of availability', () => {
		const { getByRole } = renderControls({ minPoints: 7, availability: {} });
		// All three still present (queryable), just disabled.
		expect(getByRole('radio', { name: 'Day' })).toBeInTheDocument();
		expect(getByRole('radio', { name: 'Week' })).toBeInTheDocument();
		expect(getByRole('radio', { name: 'Month' })).toBeInTheDocument();
	});
});

describe('SurfaceControls — i18n', () => {
	it('switches the disabled reason copy on locale', () => {
		const { getByRole } = renderControls({
			locale: 'fr',
			minPoints: 7,
			availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 1 } },
		});
		// FR 'no-observations' why = "pas assez de mesures".
		const month = getByRole('radio', { name: 'Month' });
		expect(month).toHaveAttribute('title', 'pas assez de mesures');
	});

	it('has no em dash in the disabled reason copy', () => {
		const { getByRole } = renderControls({
			minPoints: 7,
			availability: { day: { buckets: 30 }, month: { buckets: 1 } },
		});
		const desc = document.getElementById(
			getByRole('radio', { name: 'Month' }).getAttribute('aria-describedby') as string,
		);
		expect(desc?.textContent ?? '').not.toContain('—');
	});
});

describe('SurfaceControls — window + nav slots + caption', () => {
	it('renders the active-window caption when provided', () => {
		const { getByText } = renderControls({
			availability: { day: { buckets: 30 } },
			windowCaption: 'Today',
		});
		const caption = getByText('Today');
		expect(caption).toHaveAttribute('data-slot', 'active-window');
		expect(caption).toHaveAttribute('aria-live', 'polite');
	});
});

describe('SurfaceControls — enabled-grain hint (grain/sub-grain clarity)', () => {
	it('gives every ENABLED standard grain a positive hint title + aria-describedby by default', () => {
		const { getByRole } = renderControls({
			availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 30 } },
		});
		const week = getByRole('radio', { name: 'Week' });
		// The default hint rides the pointer title...
		expect(week).toHaveAttribute('title', 'Weekly granularity');
		// ...and an aria-describedby points at a hidden span carrying the same text.
		const descId = week.getAttribute('aria-describedby');
		expect(descId).toBeTruthy();
		expect(document.getElementById(descId as string)?.textContent).toBe('Weekly granularity');
	});

	it('localizes the default hint (fr)', () => {
		const { getByRole } = renderControls({
			locale: 'fr',
			availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 30 } },
		});
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('title', 'Granularité quotidienne');
	});

	it('lets grainHints override the default per key', () => {
		const { getByRole } = renderControls({
			availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 30 } },
			grainHints: { day: 'Today, hour by hour' } as Partial<Record<Grain, string>>,
		});
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('title', 'Today, hour by hour');
		// Un-overridden keys keep the default.
		expect(getByRole('radio', { name: 'Month' })).toHaveAttribute('title', 'Monthly granularity');
	});

	it('a DISABLED grain keeps its absence reason as the title (not a positive hint)', () => {
		const { getByRole } = renderControls({
			availability: { day: { buckets: 30 }, week: { buckets: 30 }, month: { buckets: 2 } },
		});
		expect(getByRole('radio', { name: 'Month' })).toHaveAttribute(
			'title',
			'not enough readings yet',
		);
	});
});

describe('SurfaceControls — codec purity (static source scan)', () => {
	const src = readFileSync(
		resolve(process.cwd(), 'src/lib/components/surface/SurfaceControls.svelte'),
		'utf8',
	);

	it('declares no local $state (state is owned upstream by the codec)', () => {
		expect(src).not.toMatch(/\$state\s*[(<]/);
	});

	it('never writes the URL (no goto / replaceState / mirrorSearchParams / page.url)', () => {
		expect(src).not.toContain('mirrorSearchParam');
		expect(src).not.toContain('replaceState');
		expect(src).not.toMatch(/\bgoto\b/);
		expect(src).not.toContain('page.url');
	});
});
