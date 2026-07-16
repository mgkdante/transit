import { describe, expect, it } from 'vitest';
import { r2BucketFetch, type R2BucketBinding, type R2ObjectBinding } from './binding';

const ORIGIN = 'https://transit.yesid.dev';
const SNAPSHOT_URL = 'https://data.yesid.dev/v1/stm/manifest.json';

function object(body?: BodyInit): R2ObjectBinding {
	return {
		body,
		httpEtag: '"manifest-rev-7"',
		uploaded: new Date('2026-07-15T12:00:00Z'),
		size: 18,
		writeHttpMetadata(headers) {
			headers.set('content-type', 'application/json');
			headers.set('cache-control', 'public, max-age=30');
		},
	};
}

function bucket(
	get: R2BucketBinding['get'],
	head: R2BucketBinding['head'] = async () => object(),
): R2BucketBinding {
	return { get, head };
}

describe('r2BucketFetch HTTP semantics', () => {
	it('returns 304 for a conditional HEAD whose ETag is not modified', async () => {
		const fetchR2 = r2BucketFetch(
			bucket(async () => object()),
			ORIGIN,
		);

		const response = await fetchR2(SNAPSHOT_URL, {
			method: 'HEAD',
			headers: { 'if-none-match': '"manifest-rev-7"' },
		});

		expect(response.status).toBe(304);
		expect(response.headers.get('etag')).toBe('"manifest-rev-7"');
		expect(await response.text()).toBe('');
	});

	it('returns 412 for a conditional HEAD whose If-Match precondition fails', async () => {
		const fetchR2 = r2BucketFetch(
			bucket(async () => object()),
			ORIGIN,
		);

		const response = await fetchR2(SNAPSHOT_URL, {
			method: 'HEAD',
			headers: { 'if-match': '"different-revision"' },
		});

		expect(response.status).toBe(412);
		expect(response.headers.get('etag')).toBe('"manifest-rev-7"');
		expect(await response.text()).toBe('');
	});

	it('returns 304 when an If-None-Match revalidation is not modified', async () => {
		const fetchR2 = r2BucketFetch(
			bucket(async () => object()),
			ORIGIN,
		);

		const response = await fetchR2(SNAPSHOT_URL, {
			headers: { 'if-none-match': '"manifest-rev-7"' },
		});

		expect(response.status).toBe(304);
		expect(response.headers.get('etag')).toBe('"manifest-rev-7"');
	});

	it('returns 412 when an If-Match precondition fails', async () => {
		const fetchR2 = r2BucketFetch(
			bucket(async () => object()),
			ORIGIN,
		);

		const response = await fetchR2(SNAPSHOT_URL, {
			headers: { 'if-match': '"different-revision"' },
		});

		expect(response.status).toBe(412);
		expect(response.headers.get('etag')).toBe('"manifest-rev-7"');
	});

	it('returns 304 when If-Match succeeds before a matching If-None-Match', async () => {
		const fetchR2 = r2BucketFetch(
			bucket(async () => object()),
			ORIGIN,
		);

		for (const method of ['GET', 'HEAD']) {
			const response = await fetchR2(SNAPSHOT_URL, {
				method,
				headers: {
					'if-match': '"manifest-rev-7"',
					'if-none-match': '"manifest-rev-7"',
				},
			});

			expect(response.status).toBe(304);
			expect(response.headers.get('etag')).toBe('"manifest-rev-7"');
		}
	});

	it('returns 304 when If-Unmodified-Since succeeds before a matching If-None-Match', async () => {
		const fetchR2 = r2BucketFetch(
			bucket(async () => object()),
			ORIGIN,
		);

		for (const method of ['GET', 'HEAD']) {
			const response = await fetchR2(SNAPSHOT_URL, {
				method,
				headers: {
					'if-unmodified-since': 'Wed, 15 Jul 2026 12:00:01 GMT',
					'if-none-match': '"manifest-rev-7"',
				},
			});

			expect(response.status).toBe(304);
			expect(response.headers.get('etag')).toBe('"manifest-rev-7"');
		}
	});

	it('ignores Range on a conditional HEAD request', async () => {
		const fetchR2 = r2BucketFetch(
			bucket(async (_key, options) => {
				if (options?.range) {
					throw new Error('get: The requested range is not satisfiable. (10039)');
				}
				return object();
			}),
			ORIGIN,
		);

		const response = await fetchR2(SNAPSHOT_URL, {
			method: 'HEAD',
			headers: {
				'if-none-match': '"manifest-rev-7"',
				range: 'bytes=999999-1000000',
			},
		});

		expect(response.status).toBe(304);
		expect(response.headers.get('etag')).toBe('"manifest-rev-7"');
	});

	it('returns 416 for the R2 InvalidRange error', async () => {
		const invalidRange = bucket(async () => {
			throw new Error('get: The requested range is not satisfiable. (10039)');
		});
		const fetchR2 = r2BucketFetch(invalidRange, ORIGIN);

		const response = await fetchR2(SNAPSHOT_URL, {
			headers: { range: 'bytes=999999-1000000' },
		});

		expect(response.status).toBe(416);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('does not hide an unrelated R2 failure behind a range response', async () => {
		const unavailable = r2BucketFetch(
			bucket(async () => {
				throw new Error('R2 unavailable');
			}),
			ORIGIN,
		);
		await expect(unavailable(SNAPSHOT_URL, { headers: { range: 'bytes=0-99' } })).rejects.toThrow(
			'R2 unavailable',
		);
	});
});
