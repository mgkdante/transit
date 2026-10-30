import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { SURFACE_NAV } from '../src/lib/content/nav';
import { detailCopy } from '../src/lib/features/stops/stops.copy';
import { copy as mapCopy } from '../src/lib/features/map/map.copy';
import { DEFAULT_LOCALE, PUBLISHED_LOCALES } from '../src/lib/i18n/config';

for (const locale of PUBLISHED_LOCALES)
	test(`${locale}: map credits stay immediately above the location control`, async ({ page }) => {
		await page.goto((locale === DEFAULT_LOCALE ? '' : `/${locale}`) + '/map');
		const attribution = page.getByLabel(mapCopy[locale].attributionToggle, { exact: true });
		const location = page.getByRole('button', { name: mapCopy[locale].nearMe, exact: true });
		await expect(attribution).toBeVisible();
		await expect(location).toBeVisible();
		for (const expanded of [false, true]) {
			if (expanded) await attribution.click();
			const credit = (await attribution.locator('..').boundingBox())!,
				fab = (await location.boundingBox())!;
			expect(credit.y + credit.height).toBeLessThanOrEqual(fab.y);
			expect(Math.abs(credit.x + credit.width - fab.x - fab.width)).toBeLessThanOrEqual(1);
			expect(credit.x).toBeGreaterThanOrEqual(0);
		}
		await attribution.focus();
		await attribution.press('Enter');
		await expect(attribution).toBeFocused();
	});

const departures = JSON.parse(readFileSync(new URL('./departures.json', import.meta.url), 'utf8'));
const stop = Object.keys(departures.stops)[0]!;

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

test('homepage ground follows its own scroller and reverses without moving the trigger', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/');
	const props = page.locator('[data-slot="construction-props"]');
	await expect(props).toHaveAttribute('data-state', 'hidden');
	const samples = [];
	let previousProgress = 0;
	let previousScroll = 0;
	for (const fraction of [0.98, 0.825, 0.7, 0.825, 0.98, 0.7]) {
		const requested = await page.locator('.construction-anchor').evaluate((anchor, fraction) => {
			const root = document.querySelector<HTMLElement>('#page-scroller')!;
			root.scrollTop +=
				anchor.getBoundingClientRect().top -
				root.getBoundingClientRect().top -
				root.clientHeight * fraction;
			return { scroll: root.scrollTop, top: anchor.getBoundingClientRect().top };
		}, fraction);
		await expect
			.poll(async () => {
				const progress = Number(await props.getAttribute('data-progress'));
				return (
					samples.length === 0 ||
					Math.sign(requested.scroll - previousScroll) * (progress - previousProgress) > 0
				);
			})
			.toBe(true);
		previousProgress = Number(await props.getAttribute('data-progress'));
		previousScroll = requested.scroll;
		const sample = await page.locator('.construction-anchor').evaluate((anchor) => ({
			top: anchor.getBoundingClientRect().top,
			scroll: document.querySelector('#page-scroller')!.scrollTop,
			height: document.querySelector('.home-construction-floor')!.getBoundingClientRect().height,
		}));
		expect(Math.abs(sample.top - requested.top)).toBeLessThanOrEqual(1);
		expect(Math.abs(sample.scroll - requested.scroll)).toBeLessThanOrEqual(1);
		samples.push(sample);
	}
	expect(samples[2].height).toBeGreaterThan(samples[1].height);
	expect(samples[1].height).toBeGreaterThan(samples[0].height);
	expect(Math.abs(samples[4].height - samples[0].height)).toBeLessThanOrEqual(1);
	expect(
		await page.locator('.home-construction-floor').evaluate((floor) => {
			for (let element: Element | null = floor; element; element = element.parentElement) {
				const { backgroundImage, backgroundColor } = getComputedStyle(element);
				if (
					backgroundImage !== 'none' ||
					(backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)')
				) {
					return backgroundImage;
				}
			}
			return 'none';
		}),
	).toContain('linear-gradient');
	const root = page.locator('#page-scroller');
	await root.focus();
	await root.press('End');
	await expect(props).toHaveAttribute('data-state', 'visible');
	await expect(props).toHaveAttribute('data-progress', '1');
	await expect
		.poll(() =>
			root.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
		)
		.toBeLessThanOrEqual(1);
	const art = await props
		.locator('[data-construction-prop] > svg, [data-construction-fixture] > svg')
		.evaluateAll((elements) =>
			elements
				.map((element) => element.getBoundingClientRect().toJSON())
				.sort((a, b) => a.left - b.left),
		);
	for (let i = 0; i < art.length; i++) {
		expect(art[i].left).toBeGreaterThanOrEqual(0);
		expect(art[i].right).toBeLessThanOrEqual(page.viewportSize()!.width);
		if (i) expect(art[i].left).toBeGreaterThanOrEqual(art[i - 1].right);
	}
	await expect(props.locator('[data-slot="construction-floodlight"]')).toHaveAttribute(
		'data-lit',
		'false',
	);
	await expect(
		page.locator('[data-slot="closer-floodlight"], [data-testid="hero-dot-annotation"]'),
	).toHaveCount(0);
	await page.goto('/lines');
	await expect(props).toHaveCount(0);
	await page.goto('/fr');
	await expect(props).toHaveCount(1);
});

test('homepage props remain static without JavaScript and switch instantly with reduced motion', async ({
	browser,
	baseURL,
	page,
}) => {
	const context = await browser.newContext({
		baseURL,
		viewport: page.viewportSize()!,
		javaScriptEnabled: false,
	});
	try {
		const fallback = await context.newPage();
		await fallback.goto('/');
		await expect(fallback.locator('[data-slot="construction-props"]')).toHaveAttribute(
			'data-state',
			'static',
		);
		for (const prop of await fallback.locator('[data-construction-prop]').all()) {
			await expect(prop).toBeVisible();
			const box = (await prop.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
		}
		expect(
			await fallback
				.locator('.home-construction-floor')
				.evaluate((element) => element.getBoundingClientRect().height),
		).toBeGreaterThan(0);
	} finally {
		await context.close();
	}
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	const props = page.locator('[data-slot="construction-props"]');
	await expect(props).toHaveAttribute('data-state', 'hidden');
	await page.locator('#page-scroller').focus();
	await page.locator('#page-scroller').press('End');
	await expect(props).toHaveAttribute('data-state', 'visible');
	expect(
		await props
			.locator('svg')
			.evaluateAll((elements) =>
				elements.every(
					(element) =>
						getComputedStyle(element).animationName === 'none' &&
						getComputedStyle(element).transitionDuration === '0s',
				),
			),
	).toBe(true);
});

test('the stops listing header draws in as the page scrolls', async ({ page }) => {
	test.skip(page.viewportSize()!.width < 1024, 'the scrub runs from 1024px');
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/stops');
	const art = page.locator('[data-slot="listing-frame"] .blueprint-bg svg path').first();
	const fraction = () =>
		art.evaluate((p: SVGPathElement) => {
			const [d, t] = p.style.strokeDasharray.split(',').map(parseFloat);
			return d / t;
		});
	await expect.poll(fraction).toBeGreaterThan(0);
	const before = await fraction();
	const viewport = page.viewportSize()!;
	await page.mouse.move(viewport.width / 2, viewport.height / 2);
	await page.mouse.wheel(0, 800);
	await expect.poll(fraction).toBeGreaterThan(before);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.reload();
	await expect.poll(() => art.evaluate((p: SVGPathElement) => p.style.strokeDasharray)).toBe('');
});

test("a metric's defining SQL is a named, keyboard-reachable region", async ({ page }) => {
	await page.goto('/metrics');
	const sqlCards = '[data-slot="typed-information-card"][data-kind="sql"]';
	const region = page.locator(sqlCards).first().getByRole('region');
	await expect(region).toBeVisible();
	await expect(region).toHaveAccessibleName(/\S/);
	await region.focus();
	await expect(region).toBeFocused();
	await expect(region).toContainText(/SELECT/i);
	const colors = await region.evaluate(
		(pre) =>
			new Set(Array.from(pre.querySelectorAll('span'), (span) => getComputedStyle(span).color))
				.size,
	);
	expect(colors, 'the SQL is syntax-colored').toBeGreaterThan(1);
});

test("a stop page's header canvas is decorative and fills the header", async ({ page }) => {
	await page.goto('/stop/' + stop);
	const header = page.locator('[data-slot="article-header"]');
	const canvas = header.locator('canvas').first();
	await expect(canvas).toHaveAttribute('aria-hidden', 'true');
	await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(0);
	await expect
		.poll(async () => {
			const actual = (await canvas.boundingBox())!;
			const expected = (await header.boundingBox())!;
			return Math.max(
				...(['x', 'y', 'width', 'height'] as const).map((key) =>
					Math.abs(actual[key] - expected[key]),
				),
			);
		})
		.toBeLessThanOrEqual(1);
});

test("a detail page's back link sits midway between the chrome and the next line", async ({
	page,
}) => {
	await page.goto('/stop/' + stop);
	const link = page.getByRole('link', { name: detailCopy.en.back, exact: true });
	await expect(link).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await expect
		.poll(async () => {
			const [above, below] = await page.evaluate(
				({ back, network }) => {
					const link = [...document.querySelectorAll('a')].find(
						(a) => a.textContent?.trim() === back,
					)!;
					const range = document.createRange();
					range.selectNodeContents(link);
					const text = range.getBoundingClientRect();
					const pill = document.querySelector('[data-testid="nav-pill"]')!.getBoundingClientRect();
					const select = document
						.querySelector(`select[aria-label="${network}"]`)!
						.parentElement!.getBoundingClientRect();
					const chrome = Math.max(pill.bottom, select.bottom);
					return [
						text.top - chrome,
						link.nextElementSibling!.getBoundingClientRect().top - text.bottom,
					];
				},
				{ back: detailCopy.en.back, network: navPillCopy.en.network },
			);
			return Math.abs(above - below);
		})
		.toBeLessThanOrEqual(1);
});

test('listing headers draw at the package ink and rest their copy on the band floor', async ({
	page,
}) => {
	let listings = 0;
	for (const { href } of SURFACE_NAV) {
		await page.goto(href);
		const header = page.locator('[data-slot="blueprint-listing-header"]');
		if (!(await header.count())) continue;
		listings += 1;
		await page.evaluate(() => document.fonts.ready);
		for (const theme of ['dark', 'light'] as const) {
			const { ink, drawings, gap } = await header.evaluate((band, theme) => {
				document.documentElement.dataset.theme = theme;
				const art = band.querySelector('[data-slot="blueprint-listing-art"]')!;
				// What a drawing shows: its own opacity times its wrappers' inside the art slot.
				const rendered = (drawing: Element) => {
					let opacity = 1;
					for (
						let node: Element | null = drawing;
						node && node !== art;
						node = node.parentElement
					) {
						opacity *= Number(getComputedStyle(node).opacity);
					}
					return opacity;
				};
				const content = band.querySelector('[data-slot="blueprint-listing-content"]')!;
				const copy = [
					content.firstElementChild!.lastElementChild!,
					...[...content.children].slice(1),
				];
				const lowest = Math.max(...copy.map((element) => element.getBoundingClientRect().bottom));
				return {
					ink: Number(getComputedStyle(art).getPropertyValue('--blueprint-ink')),
					drawings: [...art.querySelectorAll('svg')].map(rendered),
					gap:
						band.getBoundingClientRect().bottom -
						parseFloat(getComputedStyle(content).paddingBottom) -
						lowest,
				};
			}, theme);
			expect(ink, `${href} ${theme}`).toBeGreaterThan(0);
			expect(drawings.length, `${href} ${theme}`).toBeGreaterThan(1);
			for (const opacity of drawings) expect(opacity, `${href} ${theme}`).toBeCloseTo(ink, 3);
			expect(Math.abs(gap), `${href} ${theme}`).toBeLessThanOrEqual(1);
		}
	}
	expect(listings).toBeGreaterThan(0);
});
