import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	MOBILE_GEOMETRY_ROUTES,
	MOBILE_GEOMETRY_VIEWPORT,
	MOBILE_REQUIRED_EVIDENCE,
	type MobileGeometryRoute,
	type MobileGeometryRun,
	type MobileInteractionResult,
	type MobileRouteGeometry,
	validateMobileGeometryRun,
} from './mobile-geometry-contract';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5177';

export const MOBILE_CARD_OUTSIDE_PROBE_SELECTORS = [
	'.section-subtitle--article-summary',
	'[data-section-trigger]',
] as const;

export function resolveMobileGeometryBaseUrl(value: string | undefined): string {
	const parsed = new URL(value || DEFAULT_BASE_URL);
	if (parsed.port === '5174') {
		throw new Error('Port 5174 is reserved and must not be touched by the mobile geometry harness');
	}
	return parsed.toString().replace(/\/$/, '');
}

export function buildChromeLaunchArgs(profileDir: string, startupUrl = 'about:blank'): string[] {
	return [
		'--headless=new',
		'--disable-background-networking',
		'--disable-component-update',
		'--disable-default-apps',
		'--disable-extensions',
		'--disable-sync',
		'--metrics-recording-only',
		'--no-first-run',
		'--no-sandbox',
		'--remote-debugging-address=127.0.0.1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profileDir}`,
		`--window-size=${MOBILE_GEOMETRY_VIEWPORT.width},${MOBILE_GEOMETRY_VIEWPORT.height}`,
		startupUrl,
	];
}

interface CdpError {
	message: string;
}

interface CdpMessage {
	id?: number;
	result?: unknown;
	error?: CdpError;
	method?: string;
}

interface PendingCommand {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface RuntimeEvaluateResult {
	result: { value?: unknown; description?: string };
	exceptionDetails?: { text?: string; exception?: { description?: string } };
}

interface PageNavigateResult {
	errorText?: string;
}

interface ChromeTarget {
	type: string;
	url?: string;
	webSocketDebuggerUrl?: string;
}

interface ChromeHandle {
	process: ChildProcess;
	profileDir: string;
	debugOrigin: string;
}

interface HarnessOptions {
	baseUrl?: string;
	chromePath?: string;
	log?: (line: string) => void;
}

interface InitialPageState {
	href: string;
	readyState: string;
}

const REQUIRED_ROUTE_WAIT_MS = 30_000;
const NAVIGATION_WAIT_MS = 20_000;
const CDP_COMMAND_WAIT_MS = 20_000;

class CdpClient {
	private nextId = 1;
	private pending = new Map<number, PendingCommand>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener('message', (event) => void this.receive(event));
		socket.addEventListener('close', () => {
			for (const command of this.pending.values()) {
				clearTimeout(command.timer);
				command.reject(new Error('Chrome DevTools connection closed'));
			}
			this.pending.clear();
		});
	}

	static async connect(url: string): Promise<CdpClient> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('Timed out opening the Chrome DevTools connection')),
				CDP_COMMAND_WAIT_MS,
			);
			socket.addEventListener(
				'open',
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
			socket.addEventListener(
				'error',
				() => {
					clearTimeout(timer);
					reject(new Error('Chrome DevTools WebSocket failed to open'));
				},
				{ once: true },
			);
		});
		return new CdpClient(socket);
	}

	async command<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = this.nextId++;
		if (process.env.CDP_DEBUG === '1') console.error(`[cdp] -> ${id} ${method}`);
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Chrome DevTools command timed out: ${method}`));
			}, CDP_COMMAND_WAIT_MS);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	close(): void {
		this.socket.close();
	}

	private async receive(event: MessageEvent): Promise<void> {
		let raw: string;
		if (typeof event.data === 'string') raw = event.data;
		else if (event.data instanceof Blob) raw = await event.data.text();
		else if (event.data instanceof ArrayBuffer) raw = new TextDecoder().decode(event.data);
		else return;
		const message = JSON.parse(raw) as CdpMessage;
		if (
			process.env.CDP_DEBUG === '1' &&
			message.method &&
			(message.method.startsWith('Page.') || message.method.startsWith('Target.'))
		) {
			console.error(`[cdp] event ${message.method}`);
		}
		if (process.env.CDP_DEBUG === '1' && message.id != null) {
			console.error(
				`[cdp] <- ${message.id}${message.error ? ` ERROR ${message.error.message}` : ''}`,
			);
		}
		if (message.id == null) return;
		const command = this.pending.get(message.id);
		if (!command) return;
		this.pending.delete(message.id);
		clearTimeout(command.timer);
		if (message.error) command.reject(new Error(message.error.message));
		else command.resolve(message.result);
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isMobileGeometryInitialPageReady(
	state: InitialPageState,
	baseUrl: string,
): boolean {
	if (state.readyState !== 'complete') return false;
	try {
		return new URL(state.href).origin === new URL(baseUrl).origin;
	} catch {
		return false;
	}
}

async function launchChrome(chromePath: string, startupUrl: string): Promise<ChromeHandle> {
	const profileDir = mkdtempSync(join(tmpdir(), 'transit-mobile-geometry-'));
	const chrome = spawn(chromePath, buildChromeLaunchArgs(profileDir, startupUrl), {
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	try {
		const browserWebSocket = await new Promise<string>((resolve, reject) => {
			let stderr = '';
			const timer = setTimeout(() => {
				reject(new Error(`Chrome did not expose DevTools in time. stderr: ${stderr.trim()}`));
			}, CDP_COMMAND_WAIT_MS);
			const finish = (value: string) => {
				clearTimeout(timer);
				resolve(value);
			};
			chrome.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
				const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
				if (match?.[1]) finish(match[1]);
			});
			chrome.once('exit', (code) => {
				clearTimeout(timer);
				reject(
					new Error(`Chrome exited before DevTools was ready (code ${code}). ${stderr.trim()}`),
				);
			});
		});
		const parsed = new URL(browserWebSocket);
		return {
			process: chrome,
			profileDir,
			debugOrigin: `http://127.0.0.1:${parsed.port}`,
		};
	} catch (error) {
		chrome.kill('SIGTERM');
		rmSync(profileDir, { force: true, recursive: true });
		throw error;
	}
}

async function stopChrome(handle: ChromeHandle): Promise<void> {
	if (handle.process.exitCode == null && handle.process.signalCode == null) {
		handle.process.kill('SIGTERM');
		await Promise.race([
			new Promise<void>((resolve) => handle.process.once('exit', () => resolve())),
			delay(2_000),
		]);
	}
	if (handle.process.exitCode == null && handle.process.signalCode == null) {
		handle.process.kill('SIGKILL');
		await new Promise<void>((resolve) => handle.process.once('exit', () => resolve()));
	}
	rmSync(handle.profileDir, { force: true, recursive: true });
}

export function selectChromePageTarget(
	targets: readonly ChromeTarget[],
	baseUrl: string,
): string | null {
	const expectedOrigin = new URL(baseUrl).origin;
	const page = targets.find((target) => {
		if (target.type !== 'page' || !target.webSocketDebuggerUrl || !target.url) return false;
		try {
			return new URL(target.url).origin === expectedOrigin;
		} catch {
			return false;
		}
	});
	return page?.webSocketDebuggerUrl ?? null;
}

async function pageWebSocketUrl(debugOrigin: string, baseUrl: string): Promise<string> {
	const deadline = Date.now() + CDP_COMMAND_WAIT_MS;
	do {
		const response = await fetch(`${debugOrigin}/json/list`);
		if (!response.ok) throw new Error(`Chrome target inventory returned HTTP ${response.status}`);
		const selected = selectChromePageTarget((await response.json()) as ChromeTarget[], baseUrl);
		if (selected) return selected;
		await delay(100);
	} while (Date.now() < deadline);
	throw new Error(`Chrome did not expose a page target for ${baseUrl}`);
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
	const response = await client.command<RuntimeEvaluateResult>('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (response.exceptionDetails) {
		throw new Error(
			response.exceptionDetails.exception?.description ??
				response.exceptionDetails.text ??
				'Browser evaluation failed',
		);
	}
	return response.result.value as T;
}

async function waitForExpression(
	client: CdpClient,
	expression: string,
	timeoutMs: number,
	description: string,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	do {
		if (await evaluate<boolean>(client, expression)) return;
		await delay(200);
	} while (Date.now() < deadline);
	throw new Error(`Timed out waiting for ${description}`);
}

async function configureMobilePage(client: CdpClient): Promise<void> {
	await client.command('Page.enable');
	await client.command('Runtime.enable');
	await client.command('Network.enable');
	await client.command('Network.setBypassServiceWorker', { bypass: true });
	await client.command('Emulation.setDeviceMetricsOverride', {
		width: MOBILE_GEOMETRY_VIEWPORT.width,
		height: MOBILE_GEOMETRY_VIEWPORT.height,
		deviceScaleFactor: MOBILE_GEOMETRY_VIEWPORT.deviceScaleFactor,
		mobile: MOBILE_GEOMETRY_VIEWPORT.mobile,
		screenWidth: MOBILE_GEOMETRY_VIEWPORT.width,
		screenHeight: MOBILE_GEOMETRY_VIEWPORT.height,
	});
	await client.command('Emulation.setTouchEmulationEnabled', {
		enabled: MOBILE_GEOMETRY_VIEWPORT.touch,
		maxTouchPoints: 5,
	});
	await client.command('Emulation.setEmulatedMedia', {
		media: 'screen',
		features: [
			{ name: 'prefers-color-scheme', value: MOBILE_GEOMETRY_VIEWPORT.colorScheme },
			{ name: 'prefers-reduced-motion', value: 'no-preference' },
		],
	});
	await client.command('Emulation.setUserAgentOverride', {
		userAgent:
			'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
		platform: 'Android',
		acceptLanguage: 'en-CA,en;q=0.9,fr-CA;q=0.8',
	});
}

async function waitForInitialPage(client: CdpClient, baseUrl: string): Promise<void> {
	const deadline = Date.now() + REQUIRED_ROUTE_WAIT_MS;
	let lastState: InitialPageState | null = null;
	do {
		try {
			lastState = await evaluate<InitialPageState>(
				client,
				'({ href: location.href, readyState: document.readyState })',
			);
			if (process.env.CDP_DEBUG === '1') {
				console.error(`[cdp] startup ${lastState.readyState} ${lastState.href}`);
			}
			if (isMobileGeometryInitialPageReady(lastState, baseUrl)) return;
		} catch (error) {
			if (process.env.CDP_DEBUG === '1') {
				console.error(`[cdp] startup context unavailable: ${(error as Error).message}`);
			}
		}
		await delay(200);
	} while (Date.now() < deadline);
	throw new Error(
		`Chrome did not commit BASE_URL before navigation (last document: ${lastState?.href ?? 'unavailable'} / ${lastState?.readyState ?? 'unavailable'})`,
	);
}

function requiredSelector(route: MobileGeometryRoute): string | null {
	if (MOBILE_REQUIRED_EVIDENCE.chartOrScrollFrame.includes(route.id as never)) {
		return '[data-slot="chart-output"], [data-slot="scroll-frame"]';
	}
	if (MOBILE_REQUIRED_EVIDENCE.schedule.includes(route.id as never)) {
		return '.schedule-table-frame';
	}
	if (MOBILE_REQUIRED_EVIDENCE.map.includes(route.id as never)) {
		return '[data-slot="map-stage"] .maplibregl-ctrl-attrib';
	}
	return null;
}

async function navigate(
	client: CdpClient,
	baseUrl: string,
	route: MobileGeometryRoute,
): Promise<void> {
	const response = await client.command<PageNavigateResult>('Page.navigate', {
		url: new URL(route.path, `${baseUrl}/`).toString(),
	});
	if (response.errorText)
		throw new Error(`${route.label}: navigation failed: ${response.errorText}`);
	await waitForExpression(
		client,
		'document.readyState === "complete" && Boolean(document.querySelector("main#main, main"))',
		NAVIGATION_WAIT_MS,
		`${route.label} document readiness`,
	);
	const selector = requiredSelector(route);
	if (selector) {
		await waitForExpression(
			client,
			`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; })`,
			REQUIRED_ROUTE_WAIT_MS,
			`${route.label} required geometry`,
		);
	}
	await delay(400);
}

const CAPTURE_GEOMETRY_EXPRESSION = `(route) => {
	const readRect = (element) => {
		const rect = element.getBoundingClientRect();
		return {
			left: rect.left,
			right: rect.right,
			top: rect.top,
			bottom: rect.bottom,
			width: rect.width,
			height: rect.height,
		};
	};
	const visible = (element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
	};
	const elementLabel = (element, fallback) => {
		const labelled = element.getAttribute('aria-label');
		if (labelled) return labelled.trim();
		const card = element.closest('[data-slot="card"]');
		const trigger = card?.querySelector('[data-section-trigger]');
		const text = trigger?.textContent?.trim().replace(/\\s+/g, ' ');
		return text || fallback;
	};
	const chartOutputs = Array.from(document.querySelectorAll('[data-slot="chart-output"]'));
	const charts = chartOutputs.map((output, index) => {
		const viewport = output.querySelector('[data-slot="chart-viewport"]');
		const canvas = output.querySelector('[data-slot="chart-canvas"]');
		if (!viewport || !canvas) throw new Error('Shared chart output is missing its viewport or canvas');
		return {
			label: elementLabel(viewport, 'Shared chart ' + (index + 1)),
			layout: output.getAttribute('data-chart-layout') || 'unknown',
			visible: visible(output),
			output: readRect(output),
			viewport: readRect(viewport),
			canvas: readRect(canvas),
			clientWidth: viewport.clientWidth,
			scrollWidth: viewport.scrollWidth,
			overflowX: getComputedStyle(viewport).overflowX,
			role: viewport.getAttribute('role'),
			tabIndex: viewport.hasAttribute('tabindex') ? Number(viewport.getAttribute('tabindex')) : null,
		};
	});
	const scrollFrames = Array.from(document.querySelectorAll('[data-slot="scroll-frame"]')).map((frame, index) => {
		const viewport = frame.querySelector('[data-slot="scroll-frame-scroller"]');
		if (!viewport) throw new Error('Frozen-gutter frame is missing its scroll viewport');
		return {
			label: elementLabel(viewport, 'Frozen-gutter chart ' + (index + 1)),
			visible: visible(frame),
			frame: readRect(frame),
			viewport: readRect(viewport),
			clientWidth: viewport.clientWidth,
			scrollWidth: viewport.scrollWidth,
			overflowX: getComputedStyle(viewport).overflowX,
			role: viewport.getAttribute('role'),
			tabIndex: viewport.hasAttribute('tabindex') ? Number(viewport.getAttribute('tabindex')) : null,
		};
	});
	const schedules = Array.from(document.querySelectorAll('.schedule-table-frame')).map((frame, index) => {
		const table = frame.querySelector('.schedule-table');
		if (!table) throw new Error('Schedule frame is missing its table');
		return {
			label: elementLabel(frame, 'Schedule table ' + (index + 1)),
			visible: visible(frame),
			frame: readRect(frame),
			clientWidth: frame.clientWidth,
			scrollWidth: frame.scrollWidth,
			tableWidth: table.getBoundingClientRect().width,
			overflowX: getComputedStyle(frame).overflowX,
		};
	});
	let map = null;
	if (route.id === 'map') {
		const stage = document.querySelector('[data-slot="map-stage"]');
		const attribution = stage?.querySelector('.maplibregl-ctrl-attrib');
		if (stage && attribution) {
			const controls = Array.from(document.querySelectorAll('.map-filter-pill-container, .map-near'))
				.filter(visible)
				.map(readRect);
			map = {
				stage: readRect(stage),
				attribution: readRect(attribution),
				expanded: attribution.classList.contains('maplibregl-compact-show') || !attribution.classList.contains('maplibregl-compact'),
				controls,
			};
		}
	}
	const main = document.querySelector('main#main, main');
	return {
		routeId: route.id,
		path: route.path,
		viewportWidth: window.innerWidth,
		documents: {
			html: document.documentElement.scrollWidth,
			body: document.body.scrollWidth,
			main: main ? main.scrollWidth : null,
		},
		charts,
		scrollFrames,
		schedules,
		map,
	};
}`;

async function touchSelector(client: CdpClient, selector: string): Promise<boolean> {
	const point = await evaluate<{ found: boolean; x: number; y: number }>(
		client,
		`(() => {
			const element = document.querySelector(${JSON.stringify(selector)});
			if (!element) return { found: false, x: 0, y: 0 };
			element.scrollIntoView({ block: 'center', inline: 'nearest' });
			const rect = element.getBoundingClientRect();
			return {
				found: rect.width > 0 && rect.height > 0,
				x: Math.max(1, Math.min(innerWidth - 1, rect.left + Math.min(rect.width / 2, innerWidth / 2))),
				y: Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2)),
			};
		})()`,
	);
	if (!point.found) return false;
	await delay(100);
	await client.command('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }],
	});
	await client.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await delay(250);
	return true;
}

const INTERACTION_PROBES = [
	{
		id: 'line-heatmap',
		routeId: 'line-24-reliability',
		target: '[data-slot="scroll-frame-scroller"]',
	},
	{
		id: 'stop-heatmap',
		routeId: 'stop-52095-reliability',
		target: '[data-slot="scroll-frame-scroller"]',
	},
	{ id: 'hotspots-chart', routeId: 'hotspots', target: '[data-slot="chart-viewport"]' },
	{
		id: 'repeat-offenders-chart',
		routeId: 'repeat-offenders',
		target: '[data-slot="chart-viewport"]',
	},
	{ id: 'network-chart', routeId: 'network', target: '[data-slot="chart-viewport"]' },
] as const;

async function probeInteraction(
	client: CdpClient,
	baseUrl: string,
	probe: (typeof INTERACTION_PROBES)[number],
): Promise<MobileInteractionResult> {
	const route = MOBILE_GEOMETRY_ROUTES.find((candidate) => candidate.id === probe.routeId)!;
	await navigate(client, baseUrl, route);
	const marker = `mobile-geometry-${probe.id}`;
	const setup = await evaluate<{ found: boolean; expanded: boolean }>(
		client,
		`(() => {
			const targets = Array.from(document.querySelectorAll(${JSON.stringify(probe.target)}));
			const target = targets.find((candidate) => {
				const rect = candidate.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && candidate.closest('[data-slot="card"].section-card--toggleable');
			});
			const card = target?.closest('[data-slot="card"].section-card--toggleable');
			const trigger = card?.querySelector('[data-section-trigger]');
			const outside = card
				? ${JSON.stringify(MOBILE_CARD_OUTSIDE_PROBE_SELECTORS)}
					.map((selector) => card.querySelector(selector))
					.find(Boolean)
				: null;
			if (!target || !card || !trigger || !outside) return { found: false, expanded: false };
			card.setAttribute('data-mobile-geometry-probe', ${JSON.stringify(marker)});
			outside.setAttribute('data-mobile-geometry-outside', '');
			if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
			return { found: true, expanded: trigger.getAttribute('aria-expanded') === 'true' };
		})()`,
	);
	if (!setup.found) {
		return {
			id: probe.id,
			found: false,
			expandedBefore: false,
			expandedAfterChart: false,
			expandedAfterOutside: true,
		};
	}
	await delay(150);
	const root = `[data-mobile-geometry-probe="${marker}"]`;
	const chartTouched = await touchSelector(client, `${root} ${probe.target}`);
	const expandedAfterChart = await evaluate<boolean>(
		client,
		`document.querySelector(${JSON.stringify(`${root} [data-section-trigger]`)})?.getAttribute('aria-expanded') === 'true'`,
	);
	const outsideTouched = await touchSelector(client, `${root} [data-mobile-geometry-outside]`);
	const expandedAfterOutside = await evaluate<boolean>(
		client,
		`document.querySelector(${JSON.stringify(`${root} [data-section-trigger]`)})?.getAttribute('aria-expanded') === 'true'`,
	);
	await evaluate(
		client,
		`(() => {
			const card = document.querySelector(${JSON.stringify(root)});
			card?.querySelector('[data-mobile-geometry-outside]')?.removeAttribute('data-mobile-geometry-outside');
			card?.removeAttribute('data-mobile-geometry-probe');
		})()`,
	);
	return {
		id: probe.id,
		found: chartTouched && outsideTouched,
		expandedBefore: setup.expanded,
		expandedAfterChart,
		expandedAfterOutside,
	};
}

async function expandMapAttribution(client: CdpClient): Promise<void> {
	const state = await evaluate<{ found: boolean; expanded: boolean }>(
		client,
		`(() => {
			const attribution = document.querySelector('[data-slot="map-stage"] .maplibregl-ctrl-attrib');
			if (!attribution) return { found: false, expanded: false };
			return {
				found: true,
				expanded: attribution.classList.contains('maplibregl-compact-show') || !attribution.classList.contains('maplibregl-compact'),
			};
		})()`,
	);
	if (!state.found) return;
	if (!state.expanded) {
		await touchSelector(client, '[data-slot="map-stage"] .maplibregl-ctrl-attrib-button');
	}
}

export async function runMobileGeometryHarness(
	options: HarnessOptions = {},
): Promise<MobileGeometryRun> {
	const baseUrl = resolveMobileGeometryBaseUrl(options.baseUrl ?? process.env.BASE_URL);
	const chromePath = options.chromePath ?? process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
	const log = options.log ?? console.log;
	const preflight = await fetch(`${baseUrl}/`);
	if (!preflight.ok) throw new Error(`BASE_URL returned HTTP ${preflight.status}: ${baseUrl}`);

	const chrome = await launchChrome(chromePath, baseUrl);
	let client: CdpClient | null = null;
	try {
		client = await CdpClient.connect(await pageWebSocketUrl(chrome.debugOrigin, baseUrl));
		await configureMobilePage(client);
		await waitForInitialPage(client, baseUrl);
		log(
			`[mobile-geometry] ${MOBILE_GEOMETRY_VIEWPORT.width}x${MOBILE_GEOMETRY_VIEWPORT.height} touch/${MOBILE_GEOMETRY_VIEWPORT.colorScheme} at ${baseUrl}`,
		);

		const routes: MobileRouteGeometry[] = [];
		for (const route of MOBILE_GEOMETRY_ROUTES) {
			await navigate(client, baseUrl, route);
			if (route.id === 'map') {
				await expandMapAttribution(client);
				await delay(300);
			}
			const snapshot = await evaluate<MobileRouteGeometry>(
				client,
				`(${CAPTURE_GEOMETRY_EXPRESSION})(${JSON.stringify(route)})`,
			);
			routes.push(snapshot);
			log(
				`[mobile-geometry] captured ${route.label}: ${snapshot.charts.filter(({ visible }) => visible).length} chart(s), ${snapshot.scrollFrames.filter(({ visible }) => visible).length} frozen frame(s), ${snapshot.schedules.filter(({ visible }) => visible).length} schedule(s)`,
			);
		}

		const interactions: MobileInteractionResult[] = [];
		for (const probe of INTERACTION_PROBES) {
			const result = await probeInteraction(client, baseUrl, probe);
			interactions.push(result);
			log(
				`[mobile-geometry] interaction ${probe.id}: chart=${result.expandedAfterChart ? 'kept-open' : 'collapsed'}, outside=${result.expandedAfterOutside ? 'open' : 'collapsed'}`,
			);
		}

		const run = { routes, interactions };
		const errors = validateMobileGeometryRun(run);
		if (errors.length > 0) {
			throw new Error(
				`Mobile geometry contract failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`,
			);
		}
		log(
			`[mobile-geometry] PASS: ${routes.length}/${MOBILE_GEOMETRY_ROUTES.length} routes and ${interactions.length}/${INTERACTION_PROBES.length} interaction probes`,
		);
		return run;
	} finally {
		client?.close();
		await stopChrome(chrome);
	}
}
