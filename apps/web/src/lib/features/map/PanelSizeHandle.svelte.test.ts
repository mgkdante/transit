import { fireEvent, render } from '@testing-library/svelte';
import { it, expect, vi } from 'vitest';
import PanelSizeHandle from './PanelSizeHandle.svelte';
it.each(['en', 'fr'] as const)(
	'left separator is named and keyboard operable in %s',
	async (locale) => {
		const onchange = vi.fn();
		const view = render(PanelSizeHandle, { props: { locale, side: 'left', width: 300, onchange } });
		const handle = view.getByRole('separator');
		expect(handle).toHaveAttribute(
			'aria-valuetext',
			locale === 'en' ? 'Panel size: open' : 'Taille du panneau : ouvert',
		);
		expect(handle).toHaveAttribute('aria-orientation', 'vertical');
		await fireEvent.keyDown(handle, { key: 'Home' });
		expect(onchange).toHaveBeenLastCalledWith(56);
		await fireEvent.keyDown(handle, { key: 'End' });
		expect(onchange).toHaveBeenLastCalledWith(300);
	},
);
