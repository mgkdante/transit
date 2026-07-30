/** @typedef {'dark' | 'light'} BlueprintTheme */
/** @typedef {{ width: number, height: number }} BlueprintViewport */
/** @typedef {Record<string, number>} BlueprintTokenValues */
/**
 * @typedef {{
 *   zone: string,
 *   text: string,
 *   xPct?: number,
 *   yPct?: number,
 *   wPct?: number,
 *   hPct?: number
 * }} BlueprintIntersection
 */
/**
 * @typedef {{
 *   part: string | null,
 *   hero: boolean,
 *   xPct: number,
 *   yPct: number,
 *   wPct: number,
 *   hPct: number,
 *   ownOpacity: number,
 *   renderedOpacity: number,
 *   authoredInk: string,
 *   band: number,
 *   weightedInk: number,
 *   collisions: BlueprintIntersection[],
 *   intersectsCopyZone: boolean
 * }} BlueprintPartMeasurement
 */
/**
 * @typedef {{
 *   name: string,
 *   url: string,
 *   appliedTheme: string | null,
 *   header: { width: number, height: number },
 *   tokens: BlueprintTokenValues,
 *   copyZones: Array<{ name: string, xPct: number, yPct: number, wPct: number, hPct: number }>,
 *   parts: BlueprintPartMeasurement[],
 *   refLabelWarnings: BlueprintIntersection[]
 * }} BlueprintMeasurement
 */

/** @type {Readonly<Record<BlueprintTheme, Readonly<BlueprintTokenValues>>>} */
export const BLUEPRINT_TOKEN_VALUES = Object.freeze({
	dark: Object.freeze({
		'--blueprint-ink-quiet': 0.14,
		'--blueprint-ink-mid': 0.22,
		'--blueprint-ink-accent': 0.3,
	}),
	light: Object.freeze({
		'--blueprint-ink-quiet': 0.28,
		'--blueprint-ink-mid': 0.42,
		'--blueprint-ink-accent': 0.56,
	}),
});

/** @type {Readonly<BlueprintViewport>} */
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
/** @type {ReadonlySet<BlueprintTheme>} */
const THEMES = new Set(/** @type {BlueprintTheme[]} */ (Object.keys(BLUEPRINT_TOKEN_VALUES)));

/** @param {number} value */
function round(value) {
	return Math.round(value * 1000) / 1000;
}

/**
 * @param {string | undefined} value
 * @returns {BlueprintViewport}
 */
function parseViewport(value) {
	const match = /^(\d+)x(\d+)$/.exec(value ?? '');
	if (!match) {
		throw new Error('--viewport must use WIDTHxHEIGHT, for example 1280x900');
	}
	const width = Number.parseInt(match[1], 10);
	const height = Number.parseInt(match[2], 10);
	if (width < 1 || height < 1) {
		throw new Error('--viewport width and height must both be positive');
	}
	return { width, height };
}

/**
 * @param {string[]} args
 * @returns {{ previewUrl: URL, theme: BlueprintTheme, viewport: BlueprintViewport }}
 */
export function parseBlueprintDensityArgs(args) {
	let previewArg;
	/** @type {BlueprintTheme} */
	let theme = 'dark';
	/** @type {BlueprintViewport} */
	let viewport = { ...DEFAULT_VIEWPORT };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--theme') {
			const requestedTheme = args[index + 1];
			index += 1;
			if (!THEMES.has(/** @type {BlueprintTheme} */ (requestedTheme))) {
				throw new Error('--theme must be dark or light');
			}
			theme = /** @type {BlueprintTheme} */ (requestedTheme);
			continue;
		}
		if (arg === '--viewport') {
			viewport = parseViewport(args[index + 1]);
			index += 1;
			continue;
		}
		if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
		if (previewArg) throw new Error(`Unexpected positional argument: ${arg}`);
		previewArg = arg;
	}

	if (!previewArg) {
		throw new Error(
			'Usage: node scripts/blueprint-density-check.mjs <preview-url> [--theme dark|light] [--viewport WIDTHxHEIGHT]',
		);
	}

	const previewUrl = new URL(previewArg);
	if (!['http:', 'https:'].includes(previewUrl.protocol)) {
		throw new Error(`Preview URL must use http or https: ${previewUrl.href}`);
	}

	return { previewUrl, theme, viewport };
}

/**
 * @param {{
 *   headerSelector: string,
 *   routeName: string,
 *   tokenValues: BlueprintTokenValues,
 *   url: string
 * }} options
 * @returns {BlueprintMeasurement}
 */
export function measureBlueprintDocument({
	headerSelector,
	routeName,
	tokenValues: expectedTokens,
	url: pageUrl,
}) {
	const header = document.querySelector(headerSelector);
	if (!header) throw new Error(`Missing blueprint listing header: ${headerSelector}`);
	const headerBox = header.getBoundingClientRect();
	const rootStyle = getComputedStyle(document.documentElement);
	const tokens = Object.fromEntries(
		Object.keys(expectedTokens).map((name) => [
			name,
			Number.parseFloat(rootStyle.getPropertyValue(name)),
		]),
	);
	/** @param {DOMRect} box */
	const relativeRect = (box) => ({
		xPct: ((box.left - headerBox.left) / headerBox.width) * 100,
		yPct: ((box.top - headerBox.top) / headerBox.height) * 100,
		wPct: (box.width / headerBox.width) * 100,
		hPct: (box.height / headerBox.height) * 100,
	});
	/**
	 * @param {DOMRect} a
	 * @param {DOMRect} b
	 */
	const intersects = (a, b) =>
		a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
	/** @param {Element} element */
	const renderedOpacityToHeader = (element) => {
		let renderedOpacity = 1;
		/** @type {Element | null} */
		let current = element;
		while (current) {
			const opacity = Number.parseFloat(getComputedStyle(current).opacity);
			if (!Number.isFinite(opacity)) return Number.NaN;
			renderedOpacity *= opacity;
			if (current === header) return renderedOpacity;
			current = current.parentElement;
		}
		return Number.NaN;
	};
	const copyZones = [
		header.querySelector('.listing-header-text'),
		header.querySelector('[data-slot="listing-header-stats"]'),
	]
		.filter((element) => element !== null)
		.map((element) => ({
			name: element.matches('.listing-header-text') ? 'title-lede' : 'metrics',
			box: element.getBoundingClientRect(),
		}));

	const parts = [...header.querySelectorAll('[data-blueprint-part]')].map((element) => {
		const box = element.getBoundingClientRect();
		const geometry = relativeRect(box);
		const ownOpacity = Number.parseFloat(getComputedStyle(element).opacity);
		const renderedOpacity = renderedOpacityToHeader(element);
		const centerPct = geometry.xPct + geometry.wPct / 2;
		const band = Number.isFinite(centerPct)
			? Math.max(0, Math.min(2, Math.floor(centerPct / (100 / 3))))
			: Number.NaN;
		const hero =
			element.matches('[data-blueprint-layer="hero"]') ||
			Boolean(element.closest('[data-blueprint-layer="hero"]'));
		const collisions = [...element.querySelectorAll('text')].flatMap((label) => {
			const labelBox = label.getBoundingClientRect();
			return copyZones
				.filter((zone) => intersects(labelBox, zone.box))
				.map((zone) => ({
					zone: zone.name,
					text: label.textContent?.trim().replace(/\s+/g, ' ') ?? '',
					...relativeRect(labelBox),
				}));
		});

		return {
			part: element.getAttribute('data-blueprint-part'),
			hero,
			...geometry,
			ownOpacity,
			renderedOpacity,
			authoredInk: /** @type {HTMLElement | SVGElement} */ (element).style.getPropertyValue(
				'--blueprint-part-ink',
			),
			band,
			weightedInk: geometry.wPct * geometry.hPct * renderedOpacity,
			collisions,
			intersectsCopyZone: copyZones.some((zone) => intersects(box, zone.box)),
		};
	});

	// BlueprintShell's own `.ref-label` spans are warnings only. They are vendor sheet chrome,
	// pre-existing on both pages and both themes; the register carries them to the design repo.
	const refLabelWarnings = [...header.querySelectorAll('.ref-label')].flatMap((label) => {
		const labelBox = label.getBoundingClientRect();
		return copyZones
			.filter((zone) => intersects(labelBox, zone.box))
			.map((zone) => ({
				zone: zone.name,
				text: label.textContent?.trim().replace(/\s+/g, ' ') ?? '',
				...relativeRect(labelBox),
			}));
	});

	return {
		name: routeName,
		url: pageUrl,
		appliedTheme: document.documentElement.getAttribute('data-theme'),
		header: { width: headerBox.width, height: headerBox.height },
		tokens,
		copyZones: copyZones.map((zone) => ({ name: zone.name, ...relativeRect(zone.box) })),
		parts,
		refLabelWarnings,
	};
}

/**
 * @param {number} height
 * @returns {'anchor' | 'support' | 'detail' | null}
 */
function scaleRole(height) {
	if (height >= 55 && height <= 75) return 'anchor';
	if (height >= 35 && height <= 50) return 'support';
	if (height >= 15 && height <= 30) return 'detail';
	return null;
}

/**
 * @param {BlueprintMeasurement} result
 * @param {{ theme: BlueprintTheme, viewport: BlueprintViewport }} options
 */
export function validateBlueprintDensity(result, { theme, viewport }) {
	const failures = [];
	const tokenValues = BLUEPRINT_TOKEN_VALUES[theme];
	if (!tokenValues) throw new Error(`Unsupported blueprint theme: ${theme}`);

	if (result.appliedTheme !== theme) {
		failures.push(`${result.name}: applied theme is ${result.appliedTheme}, expected ${theme}`);
	}

	for (const [name, expected] of Object.entries(tokenValues)) {
		const actual = result.tokens[name];
		if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.001) {
			failures.push(`${result.name}: ${name} is ${actual}, expected ${expected}`);
		}
	}

	if (result.copyZones.length !== 2) {
		failures.push(`${result.name}: ${result.copyZones.length} copy zones, expected exactly 2`);
	}

	const heroes = result.parts.filter((part) => part.hero);
	const details = result.parts.filter((part) => !part.hero);
	const allowedOpacity = Object.values(tokenValues);
	// The restored hero is the background wash and remains partCount-only; copy-zone budgets
	// continue to govern the ten detail sheets and their engraved labels.
	for (const part of details) {
		if (
			!Number.isFinite(part.renderedOpacity) ||
			!allowedOpacity.some((value) => Math.abs(part.renderedOpacity - value) <= 0.001)
		) {
			failures.push(
				`${result.name}/${part.part}: rendered opacity ${part.renderedOpacity} is outside the ladder`,
			);
		}
		if (!/^var\(--blueprint-ink-(quiet|mid|accent)\)$/.test(part.authoredInk)) {
			failures.push(`${result.name}/${part.part}: opacity is not authored from the ladder`);
		}
		if (part.renderedOpacity > tokenValues['--blueprint-ink-quiet'] && part.intersectsCopyZone) {
			failures.push(`${result.name}/${part.part}: non-quiet part intersects the copy zone`);
		}
	}

	const roleCounts = { anchor: 0, support: 0, detail: 0 };
	const unclassified = [];
	for (const part of details) {
		const role = scaleRole(part.hPct);
		if (role) roleCounts[role] += 1;
		else unclassified.push(`${part.part} (${round(part.hPct)}%)`);
	}

	const bandInk = [0, 0, 0];
	let bandPct = [0, 0, 0];
	const desktopBudget = viewport.width === 1280;
	const labelWarnings = [];

	// Engraved-label placement gates on desktop, where parts render at their
	// assigned roles and a label inside the copy rect competes with real copy.
	// Below the desktop breakpoint the app flattens every part to quiet and the
	// copy stacks across the full drawing, so label overlap is the background
	// wash by construction: reported, not gating. The narrow cell's real gate is
	// the all-quiet assertion below.
	for (const part of details) {
		for (const collision of part.collisions) {
			const line = `${result.name}/${part.part}: label "${collision.text}" intersects ${collision.zone}`;
			if (desktopBudget) failures.push(line);
			else labelWarnings.push(line);
		}
	}

	// The narrow cell asserts the mobile flattening actually holds: every detail
	// part must RENDER at quiet. Falsifiable — removing the app's mobile media
	// rule re-exposes mid/accent ink here and this fails.
	if (!desktopBudget) {
		for (const part of details) {
			if (Math.abs(part.renderedOpacity - tokenValues['--blueprint-ink-quiet']) > 0.001) {
				failures.push(
					`${result.name}/${part.part}: renders ${part.renderedOpacity} at narrow width, expected quiet ${tokenValues['--blueprint-ink-quiet']}`,
				);
			}
		}
	}

	if (desktopBudget) {
		if (heroes.length !== 1) {
			failures.push(`${result.name}: ${heroes.length} hero parts, expected exactly 1`);
		}
		if (details.length !== 10) {
			failures.push(`${result.name}: ${details.length} detail parts, expected exactly 10`);
		}

		const accentCount = details.filter(
			(part) => Math.abs(part.renderedOpacity - tokenValues['--blueprint-ink-accent']) <= 0.001,
		).length;
		if (accentCount > 2) {
			failures.push(`${result.name}: ${accentCount} accent parts, expected at most 2`);
		}

		for (const part of details) {
			if (part.hPct > 100) failures.push(`${result.name}/${part.part}: height exceeds 100%`);
		}
		if (
			roleCounts.anchor !== 2 ||
			roleCounts.support < 4 ||
			roleCounts.support > 5 ||
			roleCounts.detail < 3 ||
			roleCounts.detail > 4 ||
			roleCounts.anchor + roleCounts.support + roleCounts.detail !== 10 ||
			unclassified.length > 0
		) {
			failures.push(
				`${result.name}: scale roles ${JSON.stringify(roleCounts)}; unclassified ${unclassified.join(', ') || 'none'}`,
			);
		}

		for (const part of details) {
			if (!Number.isInteger(part.band) || part.band < 0 || part.band > 2) {
				failures.push(`${result.name}/${part.part}: band index is not finite`);
				continue;
			}
			if (!Number.isFinite(part.weightedInk) || part.weightedInk < 0) {
				failures.push(`${result.name}/${part.part}: rendered weighted ink is ${part.weightedInk}`);
				continue;
			}
			bandInk[part.band] += part.weightedInk;
		}

		const totalInk = bandInk.reduce((sum, value) => sum + value, 0);
		if (!Number.isFinite(totalInk) || totalInk === 0) {
			failures.push(`${result.name}: total rendered detail ink is ${totalInk}`);
		} else {
			bandPct = bandInk.map((value) => (value / totalInk) * 100);
			for (const [index, share] of bandPct.entries()) {
				if (share < 25 || share > 40) {
					failures.push(
						`${result.name}: band ${index + 1} carries ${round(share)}% rendered detail ink`,
					);
				}
			}
		}
	}

	return {
		failures,
		labelWarnings,
		summary: {
			partCount: result.parts.length,
			roleCounts,
			bandInk: bandInk.map(round),
			bandPct: bandPct.map(round),
			labelCollisions: details.reduce((sum, part) => sum + part.collisions.length, 0),
			refLabelWarningCount: result.refLabelWarnings.length,
		},
	};
}
