import { fireEvent, render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import MapNorthControl from './MapNorthControl.svelte';
import { copy } from './map.copy';

it.each(['en', 'fr'] as const)(
	'is hidden and out of the tab order at north; shows with its name when rotated (%s)',
	async (locale) => {
		const onreset = vi.fn();
		const { queryByRole, getByRole, getByTestId, rerender } = render(MapNorthControl, {
			props: { copy: copy[locale], bearing: 0, pitch: 0, onreset },
		});
		expect(queryByRole('button')).toBeNull();
		expect(getByTestId('map-north-button')).toHaveAttribute('tabindex', '-1');
		await rerender({ bearing: -1 });
		const button = getByRole('button', { name: copy[locale].northControl });
		expect(button).toHaveAttribute('title', copy[locale].northControl);
		expect(button).toHaveAttribute('tabindex', '0');
		await fireEvent.click(button);
		expect(onreset).toHaveBeenCalledOnce();
		await rerender({ bearing: 0, pitch: 1 });
		expect(getByRole('button', { name: copy[locale].northControl })).toBeInTheDocument();
		await rerender({ bearing: 0.99, pitch: 0.99 });
		expect(queryByRole('button')).toBeNull();
	},
);
