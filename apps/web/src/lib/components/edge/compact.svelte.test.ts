import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AbsentValue from './AbsentValue.svelte';
import MaybeValue from './MaybeValue.svelte';
import { describeAbsence } from '#lib/site/absence.ts';
describe.each(['en', 'fr'] as const)('compact absence (%s)', (locale) => {
	it('keeps the default full sentence', () => {
		const { container } = render(AbsentValue, { reason: 'no-prediction', locale });
		const copy = describeAbsence('no-prediction', locale);
		expect(container).toHaveTextContent(copy.label);
		expect(container).toHaveTextContent(copy.why);
		expect(container.querySelector('button')).toBeNull();
	});
	it('shows a short trigger with a named, keyboard and touch reachable reason', () => {
		const { getByRole, container } = render(AbsentValue, {
			reason: 'no-prediction',
			locale,
			variant: 'compact',
		});
		const copy = describeAbsence('no-prediction', locale);
		const trigger = getByRole('button', { name: copy.label + ', ' + copy.why });
		expect(trigger).toHaveTextContent(copy.label);
		expect(trigger).not.toHaveTextContent(copy.why);
		const target = container.querySelector('[popover]');
		expect(trigger.getAttribute('popovertarget')).toBe(target?.id);
		expect(target).toHaveTextContent(copy.why);
	});
	it('forwards compact through MaybeValue without changing known values', () => {
		const { getByRole } = render(MaybeValue, {
			value: null,
			reason: 'no-prediction',
			locale,
			variant: 'compact',
		});
		expect(getByRole('button')).toHaveTextContent(describeAbsence('no-prediction', locale).label);
		const known = render(MaybeValue, {
			value: '4 min',
			reason: 'no-prediction',
			locale,
			variant: 'compact',
		});
		expect(known.container).toHaveTextContent('4 min');
		expect(known.container.querySelector('button')).toBeNull();
	});
	it('can inherit the containing row action without nesting a button', () => {
		const { container } = render(AbsentValue, {
			reason: 'no-prediction',
			locale,
			variant: 'compact',
			disclosure: false,
		});
		expect(container.querySelector('button')).toBeNull();
		expect(container.querySelector('[data-slot="absent-value"]')).toHaveAttribute(
			'title',
			describeAbsence('no-prediction', locale).why,
		);
	});
});
