import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright-core';
import { FileSource, PMTiles } from 'pmtiles';
import sharp from 'sharp';
import browserToolchain from '../browser-toolchain.json';
import { vectorStyleFromBasemap, type BasemapTheme } from '../src/lib/components/map/basemap';
import { mapViewportOptions } from '../src/lib/components/map/viewport';
import { deriveMapFitPadding, mapCameraFraming } from '../src/lib/features/map/mapCameraFraming';
import type { BasemapFile } from '../src/lib/v1/schemas/basemap';
import { verifyInstalledBrowserArtifact } from './browser-toolchain.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const outputDir = resolve(webRoot, 'static/map');
const maplibreDist = resolve(webRoot, 'node_modules/maplibre-gl/dist');
const maplibreCss = resolve(maplibreDist, 'maplibre-gl.css');
const pmtilesScript = resolve(webRoot, 'node_modules/pmtiles/dist/pmtiles.js');
const ATTRIBUTION = 'c OpenStreetMap contributors, c Protomaps';
const MAX_POSTER_BYTES = 125 * 1024;
const PLAYWRIGHT_CORE_VERSION = browserToolchain.playwrightCoreVersion;
const PINNED_CHROMIUM_VERSION = browserToolchain.browser.version;
const SHA256 = /^[0-9a-f]{64}$/u;
const RENDER_INPUT_PATHS = [
	'browser-toolchain.json',
	'scripts/build-map-posters.ts',
	'src/lib/components/map/basemap.ts',
	'src/lib/components/map/viewport.ts',
	'src/lib/features/map/mapCameraFraming.ts',
];
type Bounds = [number, number, number, number];
type ConfigBounds = {
	min_longitude: number;
	min_latitude: number;
	max_longitude: number;
	max_latitude: number;
};
interface ProviderConfig {
	provider: { provider_id: string; bounds: ConfigBounds };
	public: {
		fit_bounds: ConfigBounds | null;
		max_bounds: ConfigBounds | null;
		basemap_bounds: ConfigBounds;
		basemap_url: string;
		posters_url: string;
	};
}
interface PosterSpec {
	filename: string;
	theme: BasemapTheme;
	width: number;
	height: number;
}
interface PosterReceipt {
	schema_version: 2;
	provider_id: string;
	rendered_utc: string;
	source: {
		pmtiles_url: string;
		sha256: string;
		bytes: number;
		bounds: Bounds;
		osm_updated_utc: string;
		attribution: string;
		min_zoom: number;
		max_zoom: number;
	};
	reproduced_with: { playwright_core_version: string; chromium_version: string };
	render_inputs: Array<{ path: string; sha256: string }>;
	posters: Array<PosterSpec & { format: 'avif'; bytes: number; sha256: string }>;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
	if (actual !== expected)
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
}
function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}
function bounds(value: ConfigBounds): Bounds {
	return [value.min_longitude, value.min_latitude, value.max_longitude, value.max_latitude];
}
async function readRenderInputs(provider: string) {
	return Promise.all(
		[...RENDER_INPUT_PATHS, `../db/config/providers/${provider}.yaml`].map(async (path) => ({
			path,
			sha256: sha256(await readFile(resolve(webRoot, path))),
		})),
	);
}
async function verifyPosterReceipt(receipt: PosterReceipt, filename: string): Promise<void> {
	assertEqual(receipt.schema_version, 2, 'poster schema');
	if (!/^[a-z0-9][a-z0-9_-]*$/u.test(receipt.provider_id))
		throw new Error('Invalid poster provider');
	if (
		!receipt.source.pmtiles_url.startsWith(`/data/v1/${receipt.provider_id}/static/basemap/`) ||
		!SHA256.test(receipt.source.sha256) ||
		receipt.source.bytes <= 100_000
	)
		throw new Error('Invalid poster archive identity');
	assertEqual(receipt.source.attribution, ATTRIBUTION, 'poster attribution');
	assertEqual(receipt.source.min_zoom, 0, 'poster min zoom');
	assertEqual(receipt.source.max_zoom, 15, 'poster max zoom');
	if (
		!Number.isFinite(Date.parse(receipt.source.osm_updated_utc)) ||
		!Number.isFinite(Date.parse(receipt.rendered_utc))
	)
		throw new Error('Invalid poster dates');
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
	assertEqual(
		JSON.stringify(receipt.render_inputs),
		JSON.stringify(await readRenderInputs(receipt.provider_id)),
		'poster render inputs',
	);
	assertEqual(receipt.posters.length, 4, 'poster variants');
	const variants = receipt.posters
		.map((poster) => `${poster.theme}:${poster.width}x${poster.height}`)
		.sort();
	assertEqual(
		variants.join(','),
		['dark:390x844', 'light:390x844', 'dark:1280x720', 'light:1280x720'].sort().join(','),
		'poster dimensions/themes',
	);
	const prefix = filename.replace(/-posters\.json$/u, '');
	for (const poster of receipt.posters) {
		if (
			basename(poster.filename) !== poster.filename ||
			!poster.filename.startsWith(`${prefix}-`) ||
			!/-(dark|light)-(mobile|desktop)-\d{8}\.avif$/u.test(poster.filename)
		)
			throw new Error('Invalid poster filename');
		const bytes = await readFile(resolve(outputDir, poster.filename));
		const metadata = await sharp(bytes).metadata();
		assertEqual(poster.format, 'avif', 'poster format');
		assertEqual(metadata.format, 'heif', `${poster.filename} format`);
		assertEqual(metadata.width, poster.width, `${poster.filename} width`);
		assertEqual(metadata.height, poster.height, `${poster.filename} height`);
		assertEqual(bytes.byteLength, poster.bytes, `${poster.filename} bytes`);
		assertEqual(sha256(bytes), poster.sha256, `${poster.filename} SHA-256`);
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_POSTER_BYTES)
			throw new Error('Poster exceeds byte budget');
		console.log(`[build-map-posters] ok: ${poster.filename} (${bytes.byteLength} bytes)`);
	}
}

async function serveMaplibre(archive: Buffer) {
	const modules = new Map(
		await Promise.all(
			['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'].map(
				async (name) => [`/${name}`, await readFile(resolve(maplibreDist, name))] as const,
			),
		),
	);
	const server = createServer((request, response) => {
		if (request.url === '/') {
			response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			response.end('<main id="map"></main>');
		} else if (request.url === '/archive.pmtiles') {
			const range = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.range ?? '');
			const start = range ? Number(range[1]) : 0;
			const end = range ? Math.min(Number(range[2]), archive.length - 1) : archive.length - 1;
			if (start > end || start >= archive.length) {
				response.writeHead(416);
				response.end();
				return;
			}
			response.writeHead(range ? 206 : 200, {
				'Content-Type': 'application/octet-stream',
				'Accept-Ranges': 'bytes',
				'Content-Length': end - start + 1,
				...(range ? { 'Content-Range': `bytes ${start}-${end}/${archive.length}` } : {}),
			});
			response.end(archive.subarray(start, end + 1));
		} else {
			const module = modules.get(request.url ?? '');
			response.writeHead(module ? 200 : 404, { 'Content-Type': 'text/javascript' });
			response.end(module);
		}
	});
	await new Promise<void>((ready, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', ready);
	});
	return {
		origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		close: () =>
			new Promise<void>((done, reject) => {
				server.close((error) => (error ? reject(error) : done()));
				server.closeAllConnections();
			}),
	};
}

async function preparePage(browser: Browser, origin: string, spec: PosterSpec): Promise<Page> {
	const page = await browser.newPage({
		viewport: { width: spec.width, height: spec.height },
		deviceScaleFactor: 1,
	});
	await page.goto(origin, { waitUntil: 'domcontentloaded' });
	await page.addStyleTag({ path: maplibreCss });
	await page.addStyleTag({
		content:
			'html,body,#map{width:100%;height:100%;margin:0;overflow:hidden}body{position:fixed;inset:0}',
	});
	await page.addScriptTag({ path: pmtilesScript });
	return page;
}

async function capturePoster(
	browser: Browser,
	origin: string,
	descriptor: BasemapFile,
	framing: ReturnType<typeof mapCameraFraming>,
	spec: PosterSpec,
): Promise<Buffer> {
	const page = await preparePage(browser, origin, spec);
	try {
		const style = vectorStyleFromBasemap(descriptor, spec.theme);
		const viewport = mapViewportOptions(
			framing.bounds,
			deriveMapFitPadding(spec.width >= 1024, spec.width),
			framing.maxBounds,
		);
		const renderResult = await page.evaluate(
			async ({ style, viewport, center, maplibreUrl }) => {
				const maplibregl: typeof import('maplibre-gl') = await import(maplibreUrl);
				const globals = window as typeof window & {
					pmtiles: typeof import('pmtiles');
				};
				const protocol = new globals.pmtiles.Protocol();
				maplibregl.addProtocol('pmtiles', protocol.tile);
				const map = new maplibregl.Map({
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
			{
				style,
				viewport,
				center: framing.center,
				maplibreUrl: `${origin}/maplibre-gl.mjs`,
			},
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

async function buildPosters(providerId: string, archivePath: string): Promise<void> {
	if (!/^[a-z0-9][a-z0-9_-]*$/u.test(providerId)) throw new Error('Invalid provider id');
	const renderInputs = await readRenderInputs(providerId);
	const config: ProviderConfig = JSON.parse(
		execFileSync('uv', ['run', '--no-sync', 'transit-ops', 'show-provider', providerId], {
			cwd: resolve(webRoot, '../db'),
			encoding: 'utf8',
			env: { ...process.env, PYTHONUTF8: '1' },
		}),
	);
	assertEqual(config.provider.provider_id, providerId, 'provider config identity');
	if (
		!config.public.basemap_url?.startsWith(`/data/v1/${providerId}/static/basemap/`) ||
		!/^\/map\/basemap-[a-z0-9-]+-posters\.json$/u.test(config.public.posters_url)
	)
		throw new Error('Provider asset paths are missing or foreign');
	const receiptName = basename(config.public.posters_url);
	const archiveBytes = await readFile(archivePath);
	const archive = new PMTiles(
		new FileSource(new File([new Uint8Array(archiveBytes)], 'archive.pmtiles')),
	);
	const header = await archive.getHeader();
	const metadata = (await archive.getMetadata()) as Record<string, unknown>;
	const sourceBounds: Bounds = [header.minLon, header.minLat, header.maxLon, header.maxLat];
	const providerBounds = bounds(config.provider.bounds);
	const extractBounds = bounds(config.public.basemap_bounds);
	if (sourceBounds.some((coordinate, index) => Math.abs(coordinate - extractBounds[index]) > 1e-7))
		throw new Error('Archive geography differs from configured extract');
	assertEqual(header.tileType, 1, 'archive vector format');
	assertEqual(header.minZoom, 0, 'archive min zoom');
	assertEqual(header.maxZoom, 15, 'archive max zoom');
	const osmUpdated = String(metadata['planetiler:osm:osmosisreplicationtime']);
	if (!Number.isFinite(Date.parse(osmUpdated)))
		throw new Error('Archive lacks its source-data date');
	const framing = mapCameraFraming({
		manifest: { bbox: providerBounds },
		provider: {
			fit_bounds: config.public.fit_bounds ? bounds(config.public.fit_bounds) : null,
			max_bounds: config.public.max_bounds ? bounds(config.public.max_bounds) : null,
		},
	});
	const renderedUtc = new Date().toISOString();
	const date = renderedUtc.slice(0, 10).replaceAll('-', '');
	const source: PosterReceipt['source'] = {
		pmtiles_url: config.public.basemap_url,
		sha256: sha256(archiveBytes),
		bytes: archiveBytes.length,
		bounds: sourceBounds,
		osm_updated_utc: osmUpdated,
		attribution: ATTRIBUTION,
		min_zoom: 0,
		max_zoom: 15,
	};
	const artifact = await verifyInstalledBrowserArtifact();
	const server = await serveMaplibre(archiveBytes);
	let browser: Browser | undefined;
	const generated: Array<{ spec: PosterSpec; bytes: Buffer }> = [];
	try {
		browser = await chromium.launch({
			executablePath: artifact.paths.executablePath,
			headless: true,
			args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
		});
		assertEqual(browser.version(), PINNED_CHROMIUM_VERSION, 'poster Chromium version');
		const descriptor: BasemapFile = {
			url: `${server.origin}/archive.pmtiles`,
			attribution: ATTRIBUTION,
			generated_utc: osmUpdated,
			min_zoom: 0,
			max_zoom: 15,
		};
		for (const theme of ['dark', 'light'] as const) {
			for (const [size, width, height] of [
				['mobile', 390, 844],
				['desktop', 1280, 720],
			] as const) {
				const spec = {
					filename: `${receiptName.replace('-posters.json', '')}-${theme}-${size}-${date}.avif`,
					theme,
					width,
					height,
				};
				generated.push({
					spec,
					bytes: await capturePoster(browser, server.origin, descriptor, framing, spec),
				});
			}
		}
	} finally {
		try {
			await browser?.close();
		} finally {
			await server.close();
		}
	}
	assertEqual(
		JSON.stringify(await readRenderInputs(providerId)),
		JSON.stringify(renderInputs),
		'render inputs during generation',
	);
	const receipt: PosterReceipt = {
		schema_version: 2,
		provider_id: providerId,
		rendered_utc: renderedUtc,
		source,
		reproduced_with: {
			playwright_core_version: PLAYWRIGHT_CORE_VERSION,
			chromium_version: PINNED_CHROMIUM_VERSION,
		},
		render_inputs: renderInputs,
		posters: generated.map(({ spec, bytes }) => ({
			...spec,
			format: 'avif',
			bytes: bytes.length,
			sha256: sha256(bytes),
		})),
	};
	await mkdir(outputDir, { recursive: true });
	for (const poster of generated)
		await writeFile(resolve(outputDir, poster.spec.filename), poster.bytes);
	await writeFile(resolve(outputDir, receiptName), `${JSON.stringify(receipt, null, 2)}\n`);
	await verifyPosterReceipt(receipt, receiptName);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			check: { type: 'boolean' },
			provider: { type: 'string' },
			archive: { type: 'string' },
		},
	});
	if (values.check) {
		let checked = 0;
		for (const filename of (await readdir(outputDir)).filter((name) =>
			name.endsWith('-posters.json'),
		)) {
			const receipt: PosterReceipt = JSON.parse(
				await readFile(resolve(outputDir, filename), 'utf8'),
			);
			if (!values.provider || receipt.provider_id === values.provider) {
				await verifyPosterReceipt(receipt, filename);
				checked++;
			}
		}
		if (!checked) throw new Error('No matching poster receipts');
		return;
	}
	if (!values.provider || !values.archive)
		throw new Error('Build requires --provider <id> --archive <verified-local.pmtiles>');
	// Playwright's browser pipe requires Node on Windows; keep the public Bun command.
	if (process.versions.bun) {
		const compiled = resolve(here, '.map-posters.mjs');
		try {
			execFileSync(
				process.execPath,
				[
					'build',
					fileURLToPath(import.meta.url),
					'--target=node',
					'--packages=external',
					'--outfile',
					compiled,
				],
				{ stdio: 'inherit' },
			);
			execFileSync('node', [compiled, ...process.argv.slice(2)], { stdio: 'inherit' });
		} finally {
			await unlink(compiled).catch(() => undefined);
		}
		return;
	}
	await buildPosters(values.provider, values.archive);
}
main().catch((error) => {
	console.error('[build-map-posters] failed:', error);
	process.exit(1);
});
