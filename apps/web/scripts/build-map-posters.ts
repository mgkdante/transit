import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import sharp from 'sharp';
import { vectorStyleFromBasemap, type BasemapTheme } from '../src/lib/components/map/basemap';
import { mapViewportOptions } from '../src/lib/components/map/viewport';
import {
	deriveMapFitPadding,
	ISLAND_FIT_BOUNDS,
	MAP_MAX_BOUNDS,
	mapInitialCenter,
} from '../src/lib/features/map/mapCameraFraming';
import type { BasemapFile } from '../src/lib/v1/schemas/basemap';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const outputDir = resolve(webRoot, 'static/map');
const maplibreScript = resolve(webRoot, 'node_modules/maplibre-gl/dist/maplibre-gl.js');
const maplibreCss = resolve(webRoot, 'node_modules/maplibre-gl/dist/maplibre-gl.css');
const pmtilesScript = resolve(webRoot, 'node_modules/pmtiles/dist/pmtiles.js');

const DESCRIPTOR_URL = 'https://data.yesid.dev/v1/stm/static/basemap.json';
const PMTILES_URL = 'https://transit.yesid.dev/data/v1/stm/static/basemap/montreal.pmtiles';
const PMTILES_ETAG = '"6403e3c2777cc710276331111b570633"';
const PMTILES_RANGE = 'bytes 0-0/86282797';
const ATTRIBUTION = '© OpenStreetMap contributors, © Protomaps';
const MAX_POSTER_BYTES = 125 * 1024;
const PINNED_CHROMIUM_VERSION = '151.0.7922.34';

type PinnedDescriptor = BasemapFile & {
	schema_version: number;
	methodology_version: string;
	publish_generation_id: string;
	format: string;
};

interface PosterSpec {
	filename: string;
	theme: BasemapTheme;
	width: number;
	height: number;
}

const POSTERS: readonly PosterSpec[] = [
	{
		filename: 'basemap-montreal-dark-mobile-20260812.avif',
		theme: 'dark',
		width: 390,
		height: 844,
	},
	{
		filename: 'basemap-montreal-light-mobile-20260812.avif',
		theme: 'light',
		width: 390,
		height: 844,
	},
	{
		filename: 'basemap-montreal-dark-desktop-20260812.avif',
		theme: 'dark',
		width: 1280,
		height: 720,
	},
	{
		filename: 'basemap-montreal-light-desktop-20260812.avif',
		theme: 'light',
		width: 1280,
		height: 720,
	},
] as const;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
	if (actual !== expected) {
		throw new Error(
			`${label} changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}

async function readPinnedDescriptor(): Promise<PinnedDescriptor> {
	const descriptorResponse = await fetch(DESCRIPTOR_URL, {
		cache: 'no-store',
		headers: { 'Accept-Encoding': 'identity' },
	});
	assertEqual(descriptorResponse.status, 200, 'basemap descriptor status');

	const descriptor = (await descriptorResponse.json()) as PinnedDescriptor;
	assertEqual(descriptor.schema_version, 1, 'basemap schema_version');
	assertEqual(descriptor.methodology_version, 'static-1', 'basemap methodology_version');
	assertEqual(descriptor.format, 'pmtiles', 'basemap format');
	assertEqual(descriptor.url, PMTILES_URL, 'basemap URL');
	assertEqual(descriptor.style_url, null, 'basemap style_url');
	assertEqual(descriptor.attribution, ATTRIBUTION, 'basemap attribution');
	assertEqual(descriptor.min_zoom, 0, 'basemap min_zoom');
	assertEqual(descriptor.max_zoom, 15, 'basemap max_zoom');

	const archiveResponse = await fetch(PMTILES_URL, {
		cache: 'no-store',
		headers: { 'Accept-Encoding': 'identity', Range: 'bytes=0-0' },
	});
	assertEqual(archiveResponse.status, 206, 'PMTiles range status');
	assertEqual(archiveResponse.headers.get('etag'), PMTILES_ETAG, 'PMTiles ETag');
	assertEqual(archiveResponse.headers.get('content-range'), PMTILES_RANGE, 'PMTiles content-range');
	assertEqual((await archiveResponse.arrayBuffer()).byteLength, 1, 'PMTiles range body length');

	return descriptor;
}

async function preparePage(browser: Browser, spec: PosterSpec): Promise<Page> {
	const page = await browser.newPage({
		viewport: { width: spec.width, height: spec.height },
		deviceScaleFactor: 1,
	});
	await page.setContent('<main id="map" aria-label="Static Montréal basemap"></main>', {
		waitUntil: 'domcontentloaded',
	});
	await page.addStyleTag({ path: maplibreCss });
	await page.addStyleTag({
		content:
			'html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}body{position:fixed;inset:0}',
	});
	await page.addScriptTag({ path: maplibreScript });
	await page.addScriptTag({ path: pmtilesScript });
	return page;
}

async function capturePoster(
	browser: Browser,
	descriptor: PinnedDescriptor,
	spec: PosterSpec,
): Promise<Buffer> {
	const page = await preparePage(browser, spec);
	try {
		const style = vectorStyleFromBasemap(descriptor, spec.theme);
		const viewport = mapViewportOptions(
			ISLAND_FIT_BOUNDS,
			deriveMapFitPadding(spec.width >= 1024, spec.width),
			MAP_MAX_BOUNDS,
		);
		const renderResult = await page.evaluate(
			async ({ style, viewport, center }) => {
				const globals = window as typeof window & {
					maplibregl: typeof import('maplibre-gl');
					pmtiles: typeof import('pmtiles');
				};
				const protocol = new globals.pmtiles.Protocol();
				globals.maplibregl.addProtocol('pmtiles', protocol.tile);
				const map = new globals.maplibregl.Map({
					container: 'map',
					style,
					center,
					zoom: 11,
					...viewport,
					attributionControl: false,
					canvasContextAttributes: { desynchronized: true },
				});
				const errors: string[] = [];
				map.on('error', (event) => errors.push(String(event.error ?? 'unknown MapLibre error')));
				await new Promise<void>((resolveIdle, rejectIdle) => {
					const timeout = window.setTimeout(
						() => rejectIdle(new Error('MapLibre did not reach idle within 120 seconds')),
						120_000,
					);
					map.once('idle', () => {
						window.clearTimeout(timeout);
						resolveIdle();
					});
				});
				return { errors, center: map.getCenter().toArray(), zoom: map.getZoom() };
			},
			{ style, viewport, center: mapInitialCenter },
		);
		if (renderResult.errors.length > 0) {
			throw new Error(`MapLibre emitted errors: ${renderResult.errors.join(' | ')}`);
		}
		const png = await page.locator('#map').screenshot({ type: 'png', animations: 'disabled' });
		const avif = await sharp(png)
			.avif({ quality: 52, effort: 8, chromaSubsampling: '4:4:4' })
			.toBuffer();
		if (avif.byteLength > MAX_POSTER_BYTES) {
			throw new Error(`${spec.filename} is ${avif.byteLength} bytes; limit is ${MAX_POSTER_BYTES}`);
		}
		console.log(
			`[build-map-posters] rendered ${spec.filename} ${spec.width}x${spec.height} ` +
				`camera=${renderResult.center.map((value) => value.toFixed(5)).join(',')}@${renderResult.zoom.toFixed(3)}`,
		);
		return avif;
	} finally {
		await page.close();
	}
}

function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function main(): Promise<void> {
	const checkOnly = process.argv.includes('--check');
	await mkdir(outputDir, { recursive: true });
	const descriptor = await readPinnedDescriptor();
	const explicitExecutable = process.env.CHROME_PATH?.trim();
	const browser = await chromium.launch({
		...(explicitExecutable ? { executablePath: explicitExecutable } : {}),
		headless: true,
		args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
	});
	let drift = false;
	try {
		const browserVersion = browser.version();
		assertEqual(browserVersion, PINNED_CHROMIUM_VERSION, 'poster Chromium version');
		console.log(`[build-map-posters] browser: playwright-core 1.62.0 / Chromium ${browserVersion}`);
		for (const spec of POSTERS) {
			const generated = await capturePoster(browser, descriptor, spec);
			const outPath = resolve(outputDir, spec.filename);
			if (checkOnly) {
				const current = await readFile(outPath).catch(() => null);
				if (!current?.equals(generated)) {
					drift = true;
					console.error(`[build-map-posters] DRIFT: ${outPath} is missing or stale.`);
				} else {
					console.log(
						`[build-map-posters] ok: ${outPath} (${generated.byteLength} bytes, sha256 ${sha256(generated)})`,
					);
				}
				continue;
			}
			await writeFile(outPath, generated);
			console.log(
				`[build-map-posters] wrote ${outPath} (${generated.byteLength} bytes, sha256 ${sha256(generated)})`,
			);
		}
	} finally {
		await browser.close();
	}

	await readPinnedDescriptor();
	if (checkOnly && drift) {
		throw new Error('Poster assets are out of date. Run `bun scripts/build-map-posters.ts`.');
	}
}

main().catch((error) => {
	console.error('[build-map-posters] failed:', error);
	process.exit(1);
});
