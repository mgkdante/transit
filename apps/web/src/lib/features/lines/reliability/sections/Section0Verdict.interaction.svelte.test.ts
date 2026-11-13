import { fireEvent, render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import { isoUtc } from '#lib/v1/schemas/types.ts';
import { toReliabilityClusters } from '../clusters';
import { reliabilityCopy } from '../reliability.copy';
import Section0Verdict from './Section0Verdict.svelte';

it('a click on the pinned distribution readout leaves its card open', async () => {
	const vm = toReliabilityClusters({
		id: '24',
		periods_by_grain: [{ grain: 'day', date: '2026-06-19' }],
		generated_utc: isoUtc().parse('2026-06-19T02:00:00Z'),
		periods: [{ grain: 'day', date: '2026-06-19', p50_min: 2, p90_min: 9 }],
	}).punctuality;
	const { container, getByRole } = render(Section0Verdict, {
		props: { vm, locale: 'en', copy: reliabilityCopy.en },
	});
	const trigger = getByRole('button', { name: reliabilityCopy.en.sections.verdict.label });
	if (trigger.getAttribute('aria-expanded') !== 'true') await fireEvent.click(trigger);
	await fireEvent.click(getByRole('button', { name: reliabilityCopy.en.sections.detailShow }));
	expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await fireEvent.click(container.querySelector('[data-slot="delay-dist-readout"]')!);
	expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

it.each(['week', 'month'] as const)('keeps unpublished %s percentiles absent', async (grain) => {
	const { closedWeek } = await import('../__fixtures__/closedWeek');
	const vm = toReliabilityClusters(closedWeek, { grain }).punctuality;
	const { container } = render(Section0Verdict, {
		props: { vm, mode: grain, locale: 'en', copy: reliabilityCopy.en },
	});
	expect(vm.headline.p50Min).toBeNull();
	expect(vm.headline.p90Min).toBeNull();
	expect(vm.headline.delayHistogram).toBeNull();
	expect(container.querySelector('[data-slot="percentile-nudge"]')).toBeNull();
});
