import { expect, test } from '@playwright/test';

test('legal text links are underlined and readable in both themes', async ({ page }) => {
	await page.goto('/privacy');
	for (const colorScheme of ['dark', 'light'] as const) {
		await page.emulateMedia({ colorScheme });
		await page.reload();
		await page.evaluate((theme) => {
			document.documentElement.dataset.theme = theme;
		}, colorScheme);
		const links = page.getByRole('main').getByTestId('legal-document').getByRole('link');
		expect(await links.count()).toBeGreaterThan(0);
		const styles = await links.evaluateAll((links) => {
			const ctx = document.createElement('canvas').getContext('2d', { colorSpace: 'srgb' })!;
			const rgb = (color: string) => {
				ctx.clearRect(0, 0, 1, 1);
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1, 1);
				return Array.from(ctx.getImageData(0, 0, 1, 1).data);
			};
			const luminance = (color: number[]) =>
				color
					.slice(0, 3)
					.map((v) => {
						const s = v / 255;
						return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
					})
					.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
			return links.map((link) => {
				let ancestor: Element | null = link;
				while (ancestor && rgb(getComputedStyle(ancestor).backgroundColor)[3] === 0)
					ancestor = ancestor.parentElement;
				if (!ancestor) throw new Error('No non-transparent background for ' + link.textContent);
				const style = getComputedStyle(link);
				const fg = luminance(rgb(style.color));
				const bg = luminance(rgb(getComputedStyle(ancestor).backgroundColor));
				return {
					decoration: style.textDecorationLine,
					contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
				};
			});
		});
		for (const style of styles) {
			expect(style.decoration).toContain('underline');
			expect(style.contrast).toBeGreaterThanOrEqual(4.5);
		}
	}
});
