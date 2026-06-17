import { describe, expect, it } from 'vitest';
import config from '../../vite.config';
import type { UserConfig } from 'vite';

describe('vite production chunk contract', () => {
	it('keeps the heavy map runtime isolated behind the map route', async () => {
		const client = await resolveConfig(false);
		const build = Array.isArray(client) ? client[0]?.build : client.build;
		const output = build?.rollupOptions?.output;
		const firstOutput = Array.isArray(output) ? output[0] : output;
		const manualChunks = firstOutput?.manualChunks;

		expect(build?.chunkSizeWarningLimit).toBe(1100);
		expect(typeof manualChunks).toBe('function');
		if (typeof manualChunks !== 'function') return;

		expect(manualChunks('/repo/node_modules/maplibre-gl/dist/maplibre-gl.js')).toBe(
			'vendor-maplibre',
		);
		expect(manualChunks('/repo/node_modules/pmtiles/dist/index.js')).toBe('vendor-maplibre');
		expect(manualChunks('/repo/node_modules/maplibre-gl/dist/maplibre-gl.css')).toBeUndefined();
		expect(manualChunks('/repo/src/lib/features/map/MapHero.svelte')).toBeUndefined();
	});

	it('does not emit the map vendor chunk for the SSR build', async () => {
		const ssr = await resolveConfig(true);
		const build = Array.isArray(ssr) ? ssr[0]?.build : ssr.build;
		const output = build?.rollupOptions?.output;
		const firstOutput = Array.isArray(output) ? output[0] : output;

		expect(firstOutput?.manualChunks).toBeUndefined();
	});
});

async function resolveConfig(isSsrBuild: boolean): Promise<UserConfig> {
	if (typeof config === 'function') {
		const resolved = await config({
			command: 'build',
			mode: 'production',
			isSsrBuild,
			isPreview: false,
		});
		return Array.isArray(resolved) ? resolved[0] : resolved;
	}
	return Array.isArray(config) ? config[0] : config;
}
