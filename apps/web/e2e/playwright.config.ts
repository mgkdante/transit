import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
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

export default defineConfig({
	testDir: '.',
	// One tsconfig for every file the specs import, including app modules under src/.
	tsconfig: './tsconfig.json',
	outputDir: '../test-results',
	forbidOnly: Boolean(process.env.CI),
	reporter: process.env.CI
		? [['line'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
		: 'list',
	use: {
		baseURL: 'http://127.0.0.1:4317',
		contextOptions: { reducedMotion: 'reduce' },
		serviceWorkers: 'block',
		trace: 'retain-on-failure',
		launchOptions: { executablePath },
	},
	projects: [
		{ name: 'phone', use: { viewport: { width: 390, height: 844 } } },
		{ name: 'tablet', use: { viewport: { width: 768, height: 1024 } } },
		{ name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
	],
	webServer: [
		{
			command: 'node data.mjs',
			url: 'http://127.0.0.1:4318/v1/providers.json',
			reuseExistingServer: !process.env.CI,
		},
		// The built worker without bindings, so server-side data comes from the fixture server.
		{
			command: 'bun x wrangler dev --config wrangler.json --ip 127.0.0.1 --port 4317',
			url: 'http://127.0.0.1:4317',
			reuseExistingServer: !process.env.CI,
		},
	],
});
