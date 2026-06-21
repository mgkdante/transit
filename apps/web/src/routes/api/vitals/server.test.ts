import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

type Handler = typeof POST;

const sample = {
	name: 'LCP',
	value: 1200,
	id: 'v3-1718900000000-1',
	rating: 'good',
	navType: 'navigate',
	path: '/route/11',
	conn: '4g',
};

/** Build the minimal RequestEvent the handler reads: `request` + `platform`. */
function event(opts: {
	body?: string;
	binding?: unknown;
	contentLength?: string;
}): Parameters<Handler>[0] {
	// A minimal request stub the handler reads: headers.get('content-length') +
	// text(). We avoid a real Request so a custom content-length survives (the
	// platform Request impl recomputes it from the body, defeating the guard test).
	const headers = new Map<string, string>([['content-type', 'application/json']]);
	if (opts.contentLength !== undefined) headers.set('content-length', opts.contentLength);
	const request = {
		headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
		text: async () => opts.body ?? '',
	};
	return {
		request,
		platform: opts.binding === undefined ? undefined : { env: { WEB_VITALS: opts.binding } },
	} as unknown as Parameters<Handler>[0];
}

describe('/api/vitals POST handler', () => {
	it('204 no-op when the WEB_VITALS binding is absent (inert default)', async () => {
		const res = await POST(event({ body: JSON.stringify({ samples: [sample] }) }));
		expect(res.status).toBe(204);
		expect(await res.text()).toBe('');
	});

	it('writes one data point per sample when the binding is present', async () => {
		const writeDataPoint = vi.fn();
		const res = await POST(
			event({
				body: JSON.stringify({
					samples: [sample, { ...sample, name: 'CLS', value: 0.02, id: 'c-1' }],
				}),
				binding: { writeDataPoint },
			}),
		);
		expect(res.status).toBe(204);
		expect(writeDataPoint).toHaveBeenCalledTimes(2);

		const firstArg = writeDataPoint.mock.calls[0][0];
		expect(firstArg.indexes).toEqual(['LCP']);
		expect(firstArg.blobs).toEqual(['LCP', 'good', '/route/11', 'navigate', '4g']);
		expect(firstArg.doubles).toEqual([1200]);
	});

	it('persists conn as null when absent (no PII, no undefined leak)', async () => {
		const writeDataPoint = vi.fn();
		const { conn, ...noConn } = sample;
		void conn;
		await POST(event({ body: JSON.stringify({ samples: [noConn] }), binding: { writeDataPoint } }));
		expect(writeDataPoint.mock.calls[0][0].blobs[4]).toBeNull();
	});

	it('400 on invalid JSON, never a 500', async () => {
		const res = await POST(event({ body: '{not json', binding: { writeDataPoint: vi.fn() } }));
		expect(res.status).toBe(400);
	});

	it('400 on a malformed envelope shape', async () => {
		const res = await POST(
			event({ body: JSON.stringify({ nope: true }), binding: { writeDataPoint: vi.fn() } }),
		);
		expect(res.status).toBe(400);
	});

	it('204 (quiet) when all samples are malformed — binding never called', async () => {
		const writeDataPoint = vi.fn();
		const res = await POST(
			event({ body: JSON.stringify({ samples: [{ name: 'FID' }] }), binding: { writeDataPoint } }),
		);
		expect(res.status).toBe(204);
		expect(writeDataPoint).not.toHaveBeenCalled();
	});

	it('413 when the body exceeds the byte cap', async () => {
		const huge = JSON.stringify({
			samples: [{ ...sample, path: '/' + 'a'.repeat(5000) }],
		});
		const res = await POST(event({ body: huge, binding: { writeDataPoint: vi.fn() } }));
		expect(res.status).toBe(413);
	});

	it('413 when content-length declares an oversized payload', async () => {
		const res = await POST(
			event({
				body: JSON.stringify({ samples: [sample] }),
				contentLength: '999999',
				binding: { writeDataPoint: vi.fn() },
			}),
		);
		expect(res.status).toBe(413);
	});

	it('still 204 when writeDataPoint throws (best-effort RUM)', async () => {
		const writeDataPoint = vi.fn(() => {
			throw new Error('AE down');
		});
		const res = await POST(
			event({ body: JSON.stringify({ samples: [sample] }), binding: { writeDataPoint } }),
		);
		expect(res.status).toBe(204);
	});
});
