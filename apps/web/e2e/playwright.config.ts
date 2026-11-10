import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { yesidProjects } from '@yesid/config/playwright';
import { verifyInstalledBrowserArtifact } from '../scripts/browser-toolchain.mjs';

// The @yesid packages ship TypeScript source; Playwright never transforms node_modules.
const yesidSource = /\/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?@yesid\/[^/]+\/src\//;
registerHooks({
	resolve(specifier, context, nextResolve) {
		const relativeJs = specifier.startsWith('.') && specifier.endsWith('.js');
		return relativeJs && yesidSource.test(context.parentURL ?? '')
			? nextResolve(specifier.replace(/\.js$/, '.ts'), context)
			: nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (!yesidSource.test(url) || !url.endsWith('.ts')) return nextLoad(url, context);
		const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'));
		return { format: 'module', source, shortCircuit: true };
	},
});

// Lives in e2e/ so Playwright resolves this folder's tsconfig, not the app's (its extends is hoisted).
// CI runs the pinned Chromium from the browser toolchain; locally Playwright's own.
const executablePath = process.env.TRANSIT_BROWSER_ROOT
	? (await verifyInstalledBrowserArtifact()).paths.executablePath
	: undefined;

const port = process.env.TRANSIT_E2E_PORT ?? '4317';
const dataPort = process.env.TRANSIT_E2E_DATA_PORT ?? '4318';
const baseURL = `http://127.0.0.1:${port}`;
const dataURL = `http://127.0.0.1:${dataPort}`;

const httpSpecs = /(?:^|[\\/])(?:head-ssr|health|favicon)\.spec\.ts$/;
const jsonReporter: ['json'][] = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ? [['json']] : [];

export default defineConfig({
	testDir: '.',
	// One tsconfig for every file the specs import, including app modules under src/.
	tsconfig: './tsconfig.json',
	outputDir: '../test-results',
	forbidOnly: Boolean(process.env.CI),
	// Leave CI's shard sizing alone; keep local browser runs from saturating shared hosts.
	workers: process.env.CI ? undefined : 2,
	reporter: process.env.CI
		? [['line'], ['html', { open: 'never', outputFolder: '../playwright-report' }], ...jsonReporter]
		: 'list',
	use: {
		baseURL,
		// Content-interaction specs use a returning expanded visitor; fresh-storage specs override this.
		storageState: {
			cookies: [],
			origins: [
				{
					origin: new URL(baseURL).origin,
					localStorage: [{ name: 'sections-choice', value: 'expanded' }],
				},
			],
		},
		contextOptions: { reducedMotion: 'reduce' },
		serviceWorkers: 'block',
		trace: 'retain-on-failure',
		launchOptions: { executablePath },
	},
	projects: [
		{
			name: 'http',
			testMatch: httpSpecs,
			use: { baseURL, storageState: { cookies: [], origins: [] } },
		},
		...yesidProjects(baseURL).map((project) => ({
			...project,
			testIgnore: [/layout.*\.spec\.ts/, httpSpecs],
		})),
		...(['chromium', 'webkit'] as const).flatMap((browserName) =>
			(browserName === 'chromium'
				? [
						[360, 800],
						[390, 844],
						[768, 1024],
						[1280, 900],
						[1440, 900],
						[1920, 1080],
						[844, 390],
					]
				: [
						[1440, 900],
						[390, 844],
						[844, 390],
						[1280, 900],
					]
			).flatMap(([width, height]) =>
				(['light', 'dark'] as const)
					.filter(
						(colorScheme) =>
							colorScheme === 'light' ||
							width === 390 ||
							width === 1440 ||
							(browserName === 'chromium' && width === 1280),
					)
					.map((colorScheme) => ({
						name: `layout-${browserName}-${width}-${colorScheme}`,
						// Shard individual cases, so large matrix files cannot unbalance jobs.
						fullyParallel: true,
						testMatch: /layout.*\.spec\.ts/,
						testIgnore: [
							// Route lifecycle depends on the engine, not viewport or theme.
							...(width === 1440 && colorScheme === 'light'
								? []
								: [/layout-route-(?:lifecycle|close)\.spec\.ts/]),
							// These specs own every size/container boundary they exercise.
							// Keep both engines and themes; project viewport adds no coverage.
							...(width === 1440
								? []
								: [
										/layout-(?:cohesion|detail-navigation|sheet-scroll|cards|panel-sizes)\.spec\.ts/,
									]),
							// Polish owns a phone matrix or a desktop matrix, selected by width.
							...(width === 390 || width === 1440 ? [] : [/layout-map-polish\.spec\.ts/]),
							// Panel sizes also needs rich server-boot fixtures.
							...(process.env.TRANSIT_E2E_PANEL_SIZES === '1'
								? []
								: [/layout-panel-sizes\.spec\.ts/]),
							// The framing spec owns its laptop viewport matrix; run it once per theme.
							...(browserName === 'chromium' &&
							((width === 1920 && colorScheme === 'light') ||
								(width === 1280 && colorScheme === 'dark'))
								? []
								: [/layout-map-center\.spec\.ts/]),
						],
						use: {
							browserName,
							viewport: { width, height },
							colorScheme,
							storageState: {
								cookies: [],
								origins: [
									{
										origin: baseURL,
										localStorage: [
											{ name: 'theme', value: colorScheme },
											{ name: 'sections-choice', value: 'expanded' },
										],
									},
								],
							},
							bypassCSP: true,
							// Keep a lean trace only for unexpected failures: the action log records
							// route fetch/fulfill/abort calls with timing and stacks. Playwright records
							// network entries only with DOM snapshots, which stay off with screenshots
							// because findings already attach text and geometry and recording them is
							// costly.
							trace: {
								mode: 'retain-on-failure' as const,
								snapshots: false,
								screenshots: false,
								sources: false,
							},
							launchOptions: {
								executablePath: browserName === 'chromium' ? executablePath : undefined,
							},
						},
					})),
			),
		),
	],
	webServer: [
		{
			command: 'node data.mjs',
			url: `${dataURL}/v1/providers.json`,
			env: {
				TRANSIT_E2E_DATA_PORT: dataPort,
				TRANSIT_E2E_ORIGIN: baseURL,
				TRANSIT_E2E_PANEL_SIZES: process.env.TRANSIT_E2E_PANEL_SIZES ?? '',
			},
			reuseExistingServer: !process.env.CI,
		},
		// The built worker without bindings, so server-side data comes from the fixture server.
		{
			command: `bun x wrangler dev --config wrangler.json --ip 127.0.0.1 --port ${port} --var PUBLIC_V1_BASE:${dataURL}/v1`,
			url: baseURL,
			reuseExistingServer: !process.env.CI,
		},
	],
});
