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
