// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import { pageDataFetch } from '#lib/site/pageDataFetch.ts';

const appRequire = createRequire(import.meta.url);
const kitManifest = appRequire.resolve('@sveltejs/kit/package.json');
const kitRoot = dirname(kitManifest);
const kitRequire = createRequire(kitManifest);
const clientSource = readFileSync(join(kitRoot, 'src/runtime/client/client.js'), 'utf8');
const moduleAt = async (path: string) => import(pathToFileURL(path).href);
const { HandledHttpError } = await moduleAt(join(kitRoot, 'src/exports/internal/shared.js'));
const devalue = (await moduleAt(kitRequire.resolve('devalue'))) as {
	stringify(value: unknown, reducers?: Record<string, (value: unknown) => unknown>): string;
	unflatten(value: unknown, revivers: Record<string, (value: unknown) => unknown>): unknown;
};
const { add_data_suffix } = (await moduleAt(join(kitRoot, 'src/runtime/pathname.js'))) as {
	add_data_suffix(pathname: string): string;
};
const { INVALIDATED_PARAM, TRAILING_SLASH_PARAM } = (await moduleAt(
	join(kitRoot, 'src/runtime/shared.js'),
)) as { INVALIDATED_PARAM: string; TRAILING_SLASH_PARAM: string };
const { read_ndjson } = (await moduleAt(join(kitRoot, 'src/runtime/client/ndjson.js'))) as {
	read_ndjson(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<unknown>;
};

type DataNode = {
	type: string;
	location?: string;
	status?: number;
	nodes?: Array<DataNode | null>;
	data?: unknown;
	uses?: {
		dependencies: Set<string>;
		params: Set<string>;
		search_params: Set<string>;
		parent: boolean;
		route: boolean;
		url: boolean;
	};
};

const ast = parse(clientSource, { ecmaVersion: 'latest', sourceType: 'module' });
const functions = ['load_data', 'process_stream', 'deserialize_uses'];
const extracted = functions.map((name) => {
	const matches = ast.body.filter(
		(node) => node.type === 'FunctionDeclaration' && node.id?.name === name,
	);
	if (matches.length !== 1) throw new Error(`Expected one Kit ${name} declaration`);
	return clientSource.slice(matches[0].start, matches[0].end);
});
const kitFunctions = `${extracted.join('\n')}\n({ load_data, process_stream, deserialize_uses })`;

const dataRoutes = [
	{ pathname: '/map', dataPath: '/map/__data.json' },
	{ pathname: '/trip/T1.html', dataPath: '/trip/T1.html__data.json' },
] as const;

function loadResponse(
	response: Response,
	decoders: Record<string, (value: unknown) => unknown> = {},
	route: (typeof dataRoutes)[number] = dataRoutes[0],
) {
	const requests: Array<{ input: string; init: RequestInit }> = [];
	const runtime = vm.runInNewContext(
		kitFunctions,
		{
			URL,
			HandledHttpError,
			notify_version() {},
			Promise,
			Set,
			devalue,
			read_ndjson,
			add_data_suffix,
			INVALIDATED_PARAM,
			TRAILING_SLASH_PARAM,
			DEV: false,
			app: { decoders },
			window: {
				fetch: pageDataFetch(async (input, init) => {
					requests.push({ input: String(input), init: init ?? {} });
					return response;
				}, 'https://transit.test'),
			},
		},
		{ filename: join(kitRoot, 'src/runtime/client/client.js') },
	) as { load_data(url: URL, invalid: boolean[]): Promise<DataNode> };
	const promise = runtime.load_data(
		new URL(`https://transit.test${route.pathname}?near=45.489010`),
		[true, false],
	);
	expect(requests).toHaveLength(1);
	expect(requests[0].input).toBe(
		`https://transit.test${route.dataPath}?near=45.489010&x-sveltekit-invalidated=10`,
	);
	expect(requests[0].init).toEqual({});
	return promise;
}

function jsonResponse(
	node: unknown,
	contentType = 'application/json; charset=utf-8',
	status = 200,
) {
	return new Response(`${JSON.stringify(node)}\n`, {
		status,
		headers: { 'content-type': contentType },
	});
}

function heldResponse(firstLine: string, contentType: string) {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let observedPull!: () => void;
	const nextPull = new Promise<void>((resolve) => {
		observedPull = resolve;
	});
	let ended = false;
	const stream = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
			value.enqueue(new TextEncoder().encode(firstLine));
		},
		pull() {
			observedPull();
		},
	});
	return {
		response: new Response(stream, { headers: { 'content-type': contentType } }),
		nextPull,
		push(value: string) {
			controller.enqueue(new TextEncoder().encode(value));
		},
		close() {
			if (!ended) {
				ended = true;
				controller.close();
			}
		},
		fail(error: Error) {
			if (!ended) {
				ended = true;
				controller.error(error);
			}
		},
	};
}

async function promptly<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('Kit waited for EOF before first deferred node')),
					1000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

describe('Kit page-data response consumption', () => {
	it.each(dataRoutes)(
		'$pathname rejects malformed fixed JSON before its first valid line',
		async (route) => {
			const response = new Response('{"type":"data","nodes":[]}\ntruncated', {
				headers: { 'content-type': 'application/json' },
			});
			await expect(loadResponse(response, {}, route)).rejects.toThrow(SyntaxError);
		},
	);

	it.each([
		'/api/example',
		'/map__data.json',
		'/trip/T1.htm__data.json',
		'/trip/T1.xhtml__data.json',
		'/trip/T1.html__data.json/extra',
		'https://other.test/map/__data.json',
		'https://other.test/trip/T1.html__data.json',
	])('leaves %s unbuffered, preserving its original response', async (target) => {
		const held = heldResponse('{"ok":true}\n', 'application/json');
		try {
			const fetcher = pageDataFetch(async () => held.response, 'https://transit.test');
			expect(await promptly(fetcher(target))).toBe(held.response);
			expect(held.response.bodyUsed).toBe(false);
		} finally {
			held.close();
		}
	});

	it('preserves Request input, cancellation options, response headers and identity', async () => {
		const response = jsonResponse({ type: 'data', nodes: [] }, 'Application/JSON; charset=utf-8');
		const request = new Request('https://transit.test/map/__data.json');
		const init = { signal: new AbortController().signal, cache: 'reload' as const };
		const fetcher = pageDataFetch(async (input, options) => {
			expect(input).toBe(request);
			expect(options).toBe(init);
			return response;
		}, 'https://transit.test');
		expect(await fetcher(request, init)).toBe(response);
		expect(response.headers.get('content-type')).toBe('Application/JSON; charset=utf-8');
		expect(response.bodyUsed).toBe(false);
	});

	it.each(dataRoutes)(
		'$pathname waits for whole successful JSON before exposing fixed data',
		async (route) => {
			const payload = { type: 'data', nodes: [{ type: 'skip' }] };
			const held = heldResponse(`${JSON.stringify(payload)}\n`, 'application/json; charset=utf-8');
			const promise = loadResponse(held.response, {}, route);
			let settled = false;
			void promise.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			try {
				await promptly(held.nextPull);
				await new Promise<void>((resolve) => setImmediate(resolve));
				expect(settled).toBe(false);
			} finally {
				held.close();
			}
			expect(await promise).toMatchObject(payload);
		},
	);

	it.each(dataRoutes)(
		'$pathname rejects fixed JSON when its body fails after the first data line',
		async (route) => {
			const held = heldResponse(
				`${JSON.stringify({ type: 'data', nodes: [{ type: 'skip' }] })}\n`,
				'application/json',
			);
			const promise = loadResponse(held.response, {}, route);
			await promptly(held.nextPull);
			held.fail(new TypeError('late body failure'));
			await expect(promise).rejects.toThrow('late body failure');
		},
	);

	it('retains redirect, skip/error children, uses sets and custom devalue decoding', async () => {
		const redirect = await loadResponse(jsonResponse({ type: 'redirect', location: '/fr/map' }));
		expect(redirect).toMatchObject({ type: 'redirect', location: '/fr/map' });
		class Box {
			constructor(readonly value: string) {}
		}
		const data = JSON.parse(
			devalue.stringify(
				{ wrapped: new Box('B9') },
				{
					Box: (value) => (value instanceof Box ? value.value : undefined),
				},
			),
		) as unknown;
		const decoded = await loadResponse(
			jsonResponse({
				type: 'data',
				nodes: [
					{
						type: 'data',
						data,
						uses: {
							dependencies: ['x'],
							params: ['lang'],
							search_params: ['near'],
							parent: true,
							route: true,
							url: true,
						},
					},
					{ type: 'error', status: 503, error: { message: 'upstream' } },
					{ type: 'skip' },
					null,
				],
			}),
			{ Box: (value) => ({ kind: 'box', value }) },
		);
		const child = decoded.nodes?.[0];
		expect(child?.data).toEqual({ wrapped: { kind: 'box', value: 'B9' } });
		expect(child?.uses?.params).toEqual(new Set(['lang']));
		expect(child?.uses?.dependencies).toEqual(new Set(['x']));
		expect(child?.uses?.search_params).toEqual(new Set(['near']));
		expect(child?.uses).toMatchObject({ parent: true, route: true, url: true });
		expect(decoded.nodes?.slice(1).map((node) => node?.type ?? null)).toEqual([
			'error',
			'skip',
			null,
		]);
	});

	it('keeps non-OK JSON and HTML error behavior', async () => {
		const json = loadResponse(
			new Response(JSON.stringify({ message: 'Missing' }), {
				status: 404,
				headers: { 'content-type': 'application/json' },
			}),
		);
		await expect(json).rejects.toMatchObject({ status: 404, body: { message: 'Missing' } });
		const html = loadResponse(
			new Response('<h1>failed</h1>', { status: 500, headers: { 'content-type': 'text/html' } }),
		);
		await expect(html).rejects.toMatchObject({ status: 500, body: { message: 'Internal Error' } });
	});

	it('keeps unknown MIME on the NDJSON fallback', async () => {
		const data = JSON.parse(devalue.stringify({ fallback: 'kept' })) as unknown;
		const first = `${JSON.stringify({
			type: 'data',
			nodes: [{ type: 'data', data, uses: {} }],
		})}\n`;
		const held = heldResponse(first, 'application/octet-stream');
		try {
			const node = await promptly(loadResponse(held.response));
			expect(node.nodes?.[0]?.data).toEqual({ fallback: 'kept' });
		} finally {
			held.close();
		}
	});

	for (const mode of ['resolve', 'reject'] as const) {
		it(`keeps deferred ${mode} chunks after resolving the first node before EOF`, async () => {
			const data = JSON.parse(
				devalue.stringify(
					{ later: Promise.resolve('placeholder') },
					{
						Promise: (value) =>
							typeof (value as Promise<unknown>)?.then === 'function' ? 1 : undefined,
					},
				),
			) as unknown;
			const first = `${JSON.stringify({ type: 'data', nodes: [{ type: 'data', data, uses: {} }] })}\n`;
			const held = heldResponse(first, 'text/sveltekit-data');
			try {
				const node = await promptly(loadResponse(held.response));
				const pending = (node.nodes?.[0]?.data as { later: Promise<unknown> }).later;
				expect(pending).toBeInstanceOf(Promise);
				const checked =
					mode === 'reject'
						? expect(pending).rejects.toMatchObject({ message: 'deferred failure' })
						: expect(pending).resolves.toEqual({ ok: true });
				const value = mode === 'reject' ? { message: 'deferred failure' } : { ok: true };
				held.push(
					`${JSON.stringify({
						type: 'chunk',
						id: 1,
						[mode === 'reject' ? 'error' : 'data']: JSON.parse(devalue.stringify(value)),
					})}\n`,
				);
				held.close();
				await checked;
			} finally {
				held.close();
			}
		});
	}
});
