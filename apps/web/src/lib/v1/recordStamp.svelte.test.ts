import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import fixture from '../../../scripts/__fixtures__/b9/rich.json';
import { HistoricAvailabilityIndexSchema, ManifestSchema } from './schemas';
import { recordStamp, stampText } from './stamp';
import {
	installBrowserAdapterManifest,
	clearBrowserAdapterManifestForTests,
} from './adapter/browserManifest';
import { createRecordStamp } from './recordStamp.svelte';
import {
	createLineHistoryResource,
	loadLineHistorySeed,
} from '#lib/features/lines/reliability/data/lineHistoryResource.svelte.ts';
import { createStopHistoryResource } from '#lib/features/stops/reliability/data/stopHistoryResource.svelte.ts';
import { historyRangeRequestFromSearchParams } from './history/rangeResource.svelte';

const manifest = ManifestSchema.parse(fixture.files['manifest.json']);
afterEach(() => {
	vi.unstubAllGlobals();
	clearBrowserAdapterManifestForTests();
});
it.each(['line', 'stop', 'seeded line', 'P12a'] as const)(
	'reads the root index once for %s and its record stamp',
	async (path) => {
		const files: Record<string, unknown> = fixture.files;
		const request = vi.fn(async (input: RequestInfo | URL) => {
			const key = new URL(String(input), 'https://fixture.test').pathname.split(
				'/' + manifest.provider + '/',
			)[1];
			return new Response(JSON.stringify(files[key] ?? {}), { status: key in files ? 200 : 404 });
		});
		vi.stubGlobal('fetch', request);
		installBrowserAdapterManifest(() => manifest);
		const selection = historyRangeRequestFromSearchParams(
			new URLSearchParams('from=2026-08-27&to=2026-08-29'),
		);
		const seed =
			path === 'seeded line'
				? await loadLineHistorySeed('24', selection, { manifest, fetch: request })
				: undefined;
		let history:
			| ReturnType<typeof createLineHistoryResource>
			| ReturnType<typeof createStopHistoryResource>
			| undefined;
		let stamp!: ReturnType<typeof createRecordStamp>;
		const dispose = $effect.root(() => {
			if (path === 'line' || path === 'seeded line')
				history = createLineHistoryResource('24', selection, () => seed);
			if (path === 'stop') history = createStopHistoryResource('52095', selection);
			stamp = createRecordStamp(
				() => manifest,
				() => fixture.frozen_utc,
				history ? () => history! : undefined,
			);
		});
		try {
			flushSync();
			await vi.waitFor(() => expect(stamp.pending).toBe(false));
			expect(history?.error ?? null).toBeNull();
			expect(stamp.meta('en')?.datetime).toBe(fixture.frozen_utc.slice(0, 10));
			expect(stamp.meta('en')?.text).toBe(
				stampText(
					recordStamp({
						manifest,
						historyIndex: HistoricAvailabilityIndexSchema.parse(
							files['historic/history/index.json'],
						),
						fileGeneratedUtc: fixture.frozen_utc,
					}),
					'en',
					manifest.tz,
				),
			);
			expect(
				request.mock.calls.filter(([url]) => String(url).endsWith('/historic/history/index.json')),
			).toHaveLength(1);
		} finally {
			history?.destroy();
			dispose();
		}
	},
);
