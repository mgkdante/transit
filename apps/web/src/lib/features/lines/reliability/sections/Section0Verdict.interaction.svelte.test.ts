import { fireEvent, render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import { isoUtc } from '$lib/v1/schemas/types';
import { toReliabilityClusters } from '../clusters';
import { reliabilityCopy } from '../reliability.copy';
import Section0Verdict from './Section0Verdict.svelte';

it('a click on the pinned distribution readout leaves its card open', async () => {
	const vm = toReliabilityClusters({
		id: '24',
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

it.each(['week', 'month'] as const)(
	'labels percentile estimates from a qualifying %s headline window',
	async (grain) => {
		const vm = toReliabilityClusters(
			{
				id: '24',
				generated_utc: isoUtc().parse('2026-11-02T00:00:00Z'),
				periods: [
					{
						grain: 'day',
						date: '2026-11-02',
						otp_pct: 20,
						observation_count: 12,
						p50_min: 1,
						p90_min: 3,
					},
					{
						grain,
						date: '2026-10-27',
						otp_pct: 85,
						observation_count: 4000,
						p50_min: 2,
						p90_min: 5,
					},
				],
			},
			{ grain: 'day' },
		).punctuality;
		const { container, getByText, getByRole } = render(Section0Verdict, {
			props: { vm, locale: 'en', copy: reliabilityCopy.en },
		});
		expect(getByText(reliabilityCopy.en.strip.p50EstimatedCaption)).toBeInTheDocument();
		expect(getByText(reliabilityCopy.en.strip.p90EstimatedCaption)).toBeInTheDocument();
		await fireEvent.click(getByRole('button', { name: reliabilityCopy.en.sections.detailShow }));
		expect(container.querySelector('[data-slot="percentile-nudge"]')).toBeNull();
	},
);
