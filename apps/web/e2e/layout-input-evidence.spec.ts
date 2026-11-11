import { expect } from '@playwright/test';
import { test } from './layout-input-test';

test('retains native key delivery and handler effects after the page closes', async ({
	page,
	inputEvents,
}) => {
	await page.goto('data:text/html,<button data-slot="probe" data-detent="half">Probe</button>');
	await page.evaluate(() => {
		document.querySelector('button')!.addEventListener('keydown', (event) => {
			event.preventDefault();
			document.querySelector('button')!.setAttribute('data-detent', 'full');
		});
	});
	await page.getByRole('button').press('End');
	await expect
		.poll(() =>
			inputEvents.find((event) => event.type === 'keydown' && event.phase === 'after-dispatch'),
		)
		.toMatchObject({
			key: 'End',
			defaultPrevented: true,
			slot: 'probe',
			activeIsTarget: true,
			detent: 'full',
		});
	await page.close();
	expect(
		inputEvents.find((event) => event.type === 'keydown' && event.phase === 'capture'),
	).toMatchObject({ key: 'End', defaultPrevented: false, detent: 'half' });
	expect(inputEvents.find((event) => event.type === 'detent-change')).toMatchObject({
		previous: 'half',
		current: 'full',
	});
});
