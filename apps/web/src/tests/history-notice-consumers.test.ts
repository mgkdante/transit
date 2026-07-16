import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('retained-history no-data consumers', () => {
	it.each([
		'src/lib/features/lines/reliability/RouteReliabilityClusters.svelte',
		'src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte',
	])('%s delegates the no-data range to StateNotice', (path) => {
		const source = read(path);
		const noticeTag = source.match(
			/<StateNotice\b[^>]*\bdata-slot="history-no-data"[^>]*\/?\s*>/,
		)?.[0];

		expect(source).toContain('<StateNotice');
		expect(noticeTag).toBeDefined();
		expect(noticeTag).not.toMatch(/\brole\s*=/);
		expect(noticeTag).not.toMatch(/\bariaLive\s*=/);
		expect(source).not.toMatch(/<p\s+data-slot="history-no-data"/);
	});
});
