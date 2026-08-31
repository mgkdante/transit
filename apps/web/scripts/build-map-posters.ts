import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
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
const receiptPath = resolve(outputDir, 'basemap-montreal-posters.json');
const maplibreScript = resolve(webRoot, 'node_modules/maplibre-gl/dist/maplibre-gl.js');
const maplibreCss = resolve(webRoot, 'node_modules/maplibre-gl/dist/maplibre-gl.css');
const pmtilesScript = resolve(webRoot, 'node_modules/pmtiles/dist/pmtiles.js');

const DESCRIPTOR_URL = 'https://data.yesid.dev/v1/stm/static/basemap.json';
const PMTILES_URL = 'https://transit.yesid.dev/data/v1/stm/static/basemap/montreal.pmtiles';
const ATTRIBUTION = '© OpenStreetMap contributors, © Protomaps';
const MAX_POSTER_BYTES = 125 * 1024;
const PLAYWRIGHT_CORE_VERSION = '1.62.0';
const PINNED_CHROMIUM_VERSION = '151.0.7922.34';

type PinnedDescriptor = BasemapFile & {
	schema_version: number;
	methodology_version: string;
	publish_generation_id: string;
	generated_utc: string;
	format: string;
};

interface PosterSpec {
	filename: string;
	theme: BasemapTheme;
	width: number;
	height: number;
}

interface PosterEntry extends PosterSpec {
	bytes: number;
	sha256: string;
}

interface PosterSourceReceipt {
	descriptor_url: string;
	descriptor_etag: string;
	publish_generation_id: string;
	generated_utc: string;
	pmtiles_url: string;
	pmtiles_etag: string;
	pmtiles_size_bytes: number;
	attribution: string;
	min_zoom: number;
	max_zoom: number;
}

interface PosterReceipt {
	schema_version: 1;
	source: PosterSourceReceipt;
	reproduced_with: {
		playwright_core_version: string;
		chromium_version: string;
	};
	posters: PosterEntry[];
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
	if (actual !== expected) {
		throw new Error(
			`${label} changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}

function assertString(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`);
}

function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function validateReceipt(value: unknown): asserts value is PosterReceipt {
	if (!value || typeof value !== 'object') throw new Error('poster receipt must be an object');
	const receipt = value as Partial<PosterReceipt>;
	assertEqual(receipt.schema_version, 1, 'poster receipt schema_version');
	if (!receipt.source || typeof receipt.source !== 'object') {
		throw new Error('poster receipt source must be an object');
	}
	assertEqual(receipt.source.descriptor_url, DESCRIPTOR_URL, 'poster descriptor URL');
	assertString(receipt.source.descriptor_etag, 'poster descriptor ETag');
	assertString(receipt.source.publish_generation_id, 'poster generation ID');
	assertString(receipt.source.generated_utc, 'poster generated UTC');
	assertEqual(receipt.source.pmtiles_url, PMTILES_URL, 'poster PMTiles URL');
	assertString(receipt.source.pmtiles_etag, 'poster PMTiles ETag');
	if (
		!Number.isSafeInteger(receipt.source.pmtiles_size_bytes) ||
		receipt.source.pmtiles_size_bytes <= 100_000
	) {
		throw new Error('poster PMTiles size must be a safe integer above 100000 bytes');
	}
	assertEqual(receipt.source.attribution, ATTRIBUTION, 'poster attribution');
	assertEqual(receipt.source.min_zoom, 0, 'poster min zoom');
	assertEqual(receipt.source.max_zoom, 15, 'poster max zoom');
	if (!receipt.reproduced_with || typeof receipt.reproduced_with !== 'object') {
		throw new Error('poster renderer receipt must be an object');
	}
	assertEqual(
		receipt.reproduced_with.playwright_core_version,
		PLAYWRIGHT_CORE_VERSION,
		'poster Playwright version',
	);
	assertEqual(
		receipt.reproduced_with.chromium_version,
		PINNED_CHROMIUM_VERSION,
		'poster Chromium version',
	);
	if (!Array.isArray(receipt.posters) || receipt.posters.length !== 4) {
		throw new Error('poster receipt must contain exactly four assets');
	}
	const variants = new Set<string>();
	for (const poster of receipt.posters) {
		assertString(poster.filename, 'poster filename');
		if (
			basename(poster.filename) !== poster.filename ||
			!/^basemap-montreal-(?:dark|light)-(?:mobile|desktop)-\d{8}\.avif$/u.test(poster.filename)
		) {
			throw new Error(`unsafe or unexpected poster filename: ${poster.filename}`);
		}
		if (poster.theme !== 'dark' && poster.theme !== 'light') {
			throw new Error(`unexpected poster theme: ${String(poster.theme)}`);
		}
		if (!Number.isSafeInteger(poster.width) || !Number.isSafeInteger(poster.height)) {
			throw new Error(`${poster.filename} dimensions must be safe integers`);
		}
		if (
			!Number.isSafeInteger(poster.bytes) ||
			poster.bytes <= 0 ||
			poster.bytes > MAX_POSTER_BYTES
		) {
			throw new Error(`${poster.filename} byte receipt is outside the allowed range`);
		}
		if (!/^[0-9a-f]{64}$/u.test(poster.sha256)) {
			throw new Error(`${poster.filename} SHA-256 receipt is invalid`);
		}
		variants.add(`${poster.theme}:${poster.width}x${poster.height}`);
	}
	const expectedVariants = ['dark:390x844', 'light:390x844', 'dark:1280x720', 'light:1280x720'];
	assertEqual([...variants].sort().join(','), expectedVariants.sort().join(','), 'poster variants');
}

async function readPosterReceipt(): Promise<PosterReceipt> {
	const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as unknown;
	validateReceipt(receipt);
	return receipt;
}

async function verifyPosterReceipt(receipt: PosterReceipt): Promise<void> {
	for (const poster of receipt.posters) {
		const bytes = await readFile(resolve(outputDir, poster.filename));
		const metadata = await sharp(bytes).metadata();
		assertEqual(metadata.format, 'heif', `${poster.filename} format`);
		assertEqual(metadata.width, poster.width, `${poster.filename} width`);
		assertEqual(metadata.height, poster.height, `${poster.filename} height`);
		assertEqual(bytes.byteLength, poster.bytes, `${poster.filename} bytes`);
		assertEqual(sha256(bytes), poster.sha256, `${poster.filename} SHA-256`);
		console.log(
			`[build-map-posters] ok: ${poster.filename} (${bytes.byteLength} bytes, sha256 ${poster.sha256})`,
		);
	}
}

function requiredHeader(response: Response, name: string, label: string): string {
	const value = response.headers.get(name);
	if (!value) throw new Error(`${label} is missing ${name}`);
	return value;
}

async function readLiveSource(): Promise<{
	descriptor: PinnedDescriptor;
	source: PosterSourceReceipt;
}> {
	const descriptorResponse = await fetch(DESCRIPTOR_URL, {
		cache: 'no-store',
		headers: { 'Accept-Encoding': 'identity' },
	});
	assertEqual(descriptorResponse.status, 200, 'basemap descriptor status');
	const descriptorEtag = requiredHeader(descriptorResponse, 'etag', 'basemap descriptor');
	const descriptor = (await descriptorResponse.json()) as PinnedDescriptor;
	assertEqual(descriptor.schema_version, 1, 'basemap schema_version');
	assertEqual(descriptor.methodology_version, 'static-1', 'basemap methodology_version');
	assertString(descriptor.publish_generation_id, 'basemap publish_generation_id');
	assertString(descriptor.generated_utc, 'basemap generated_utc');
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
	const contentRange = requiredHeader(archiveResponse, 'content-range', 'PMTiles range response');
	const rangeMatch = /^bytes 0-0\/(\d+)$/u.exec(contentRange);
	if (!rangeMatch) throw new Error(`unexpected PMTiles content-range: ${contentRange}`);
	const pmtilesSize = Number(rangeMatch[1]);
	if (!Number.isSafeInteger(pmtilesSize) || pmtilesSize <= 100_000) {
		throw new Error(`unexpected PMTiles size: ${rangeMatch[1]}`);
	}
	assertEqual((await archiveResponse.arrayBuffer()).byteLength, 1, 'PMTiles range body length');

	return {
		descriptor,
		source: {
			descriptor_url: DESCRIPTOR_URL,
			descriptor_etag: descriptorEtag,
			publish_generation_id: descriptor.publish_generation_id,
			generated_utc: descriptor.generated_utc,
			pmtiles_url: PMTILES_URL,
			pmtiles_etag: requiredHeader(archiveResponse, 'etag', 'PMTiles range response'),
			pmtiles_size_bytes: pmtilesSize,
			attribution: ATTRIBUTION,
			min_zoom: 0,
			max_zoom: 15,
		},
	};
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

async function buildPosters(seed: PosterReceipt): Promise<void> {
	await mkdir(outputDir, { recursive: true });
	const liveBefore = await readLiveSource();
	const explicitExecutable = process.env.CHROME_PATH?.trim();
	const browser = await chromium.launch({
		...(explicitExecutable ? { executablePath: explicitExecutable } : {}),
		headless: true,
		args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
	});
	const generated: Array<{ spec: PosterSpec; bytes: Buffer }> = [];
	let browserVersion: string;
	try {
		browserVersion = browser.version();
		assertEqual(browserVersion, PINNED_CHROMIUM_VERSION, 'poster Chromium version');
		console.log(
			`[build-map-posters] browser: playwright-core ${PLAYWRIGHT_CORE_VERSION} / Chromium ${browserVersion}`,
		);
		for (const poster of seed.posters) {
			const spec: PosterSpec = {
				filename: poster.filename,
				theme: poster.theme,
				width: poster.width,
				height: poster.height,
			};
			generated.push({ spec, bytes: await capturePoster(browser, liveBefore.descriptor, spec) });
		}
	} finally {
		await browser.close();
	}

	const liveAfter = await readLiveSource();
	assertEqual(
		JSON.stringify(liveAfter.source),
		JSON.stringify(liveBefore.source),
		'basemap source identity during poster render',
	);
	for (const poster of generated) {
		const outPath = resolve(outputDir, poster.spec.filename);
		await writeFile(outPath, poster.bytes);
		console.log(
			`[build-map-posters] wrote ${outPath} (${poster.bytes.byteLength} bytes, sha256 ${sha256(poster.bytes)})`,
		);
	}
	const receipt: PosterReceipt = {
		schema_version: 1,
		source: liveBefore.source,
		reproduced_with: {
			playwright_core_version: PLAYWRIGHT_CORE_VERSION,
			chromium_version: browserVersion,
		},
		posters: generated.map(({ spec, bytes }) => ({
			...spec,
			bytes: bytes.byteLength,
			sha256: sha256(bytes),
		})),
	};
	await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	await verifyPosterReceipt(receipt);
}

async function main(): Promise<void> {
	const receipt = await readPosterReceipt();
	if (process.argv.includes('--check')) {
		await verifyPosterReceipt(receipt);
		return;
	}
	await buildPosters(receipt);
}

main().catch((error) => {
	console.error('[build-map-posters] failed:', error);
	process.exit(1);
});
