import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	deferMapFocusInset,
	measureMapFocusInset,
	MIN_VISIBLE_SPAN_PX,
	type MapFocusMeasurementAdapter,
} from './mapFocusInset';

function rect(width: number, height: number): DOMRect {
	return {
		x: 0,
		y: 0,
		width,
		height,
		top: 0,
		right: width,
		bottom: height,
		left: 0,
		toJSON: () => ({}),
	};
}

function mountedMap() {
	const hero = document.createElement('div');
	hero.className = 'map-hero';
	const container = document.createElement('div');
	hero.append(container);
	document.body.append(hero);
	return { hero, container, map: { getContainer: () => container } };
}

function measurementAdapter(
	overrides: Partial<{
		width: number;
		height: number;
		detailOffset: string;
		rootFontSize: number;
		sheetHeight: number | null;
	}> = {},
) {
	const values = {
		width: 1040,
		height: 800,
		detailOffset: '560px',
		rootFontSize: 16,
		sheetHeight: null,
		...overrides,
	};
	const frames: FrameRequestCallback[] = [];
	const adapter: MapFocusMeasurementAdapter = {
		containerRect: vi.fn(() => rect(values.width, values.height)),
		detailOffset: vi.fn(() => values.detailOffset),
		rootFontSize: vi.fn(() => values.rootFontSize),
		bottomSheetHeight: vi.fn(() => values.sheetHeight),
		requestFrame: vi.fn((callback) => {
			frames.push(callback);
			return frames.length;
		}),
	};
	return { adapter, frames, values };
}

async function reachFrame(frames: FrameRequestCallback[]): Promise<void> {
	await tick();
	await Promise.resolve();
	expect(frames).toHaveLength(1);
	frames.shift()!(0);
	await Promise.resolve();
	await Promise.resolve();
}

afterEach(() => {
	document.body.replaceChildren();
	document.documentElement.style.removeProperty('font-size');
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('map focus inset arithmetic', () => {
	it('keeps the pinned 1040/560 target geometry visible for point and route focus', () => {
		const { map } = mountedMap();
		const { adapter } = measurementAdapter();

		const inset = measureMapFocusInset(map, adapter);

		expect(MIN_VISIBLE_SPAN_PX).toBe(240);
		expect(inset).toEqual({
			containerWidth: 1040,
			containerHeight: 800,
			rightOcclusion: 560,
			bottomOcclusion: 0,
			pointOffset: [-280, 0],
			routePadding: { top: 64, right: 624, bottom: 64, left: 64 },
		});
		expect(inset.containerWidth - (inset.routePadding.left + inset.routePadding.right)).toBe(352);
		expect(inset.containerHeight - (inset.routePadding.top + inset.routePadding.bottom)).toBe(672);
	});

	it('clamps each occlusion against a 240px map-container visible span', () => {
		const { map } = mountedMap();
		const { adapter } = measurementAdapter({ detailOffset: '5000px', sheetHeight: 5000 });

		const inset = measureMapFocusInset(map, adapter);
		expect(inset).toMatchObject({
			rightOcclusion: 800,
			bottomOcclusion: 560,
			pointOffset: [-400, -280],
			routePadding: { top: 64, right: 864, bottom: 624, left: 64 },
		});
		expect(inset.containerWidth - (inset.routePadding.left + inset.routePadding.right)).toBe(112);
		expect(inset.containerHeight - (inset.routePadding.top + inset.routePadding.bottom)).toBe(112);
	});

	it.each([
		['negative occlusion', 1040, 800, '-40px', -20],
		['sub-240 container', 200, 180, '5000px', 5000],
	] as const)('clamps %s to zero', (_case, width, height, detailOffset, sheetHeight) => {
		const { map } = mountedMap();
		const { adapter } = measurementAdapter({ width, height, detailOffset, sheetHeight });

		expect(measureMapFocusInset(map, adapter)).toMatchObject({
			rightOcclusion: 0,
			bottomOcclusion: 0,
			pointOffset: [0, 0],
		});
	});

	it.each([
		['560px', 16, 560],
		['3.7rem', 16, 59.2],
		['3.7rem', 20, 74],
		['0rem', 16, 0],
	] as const)('parses target --map-detail-offset %s at a %spx root', (value, root, expected) => {
		const { map } = mountedMap();
		const { adapter } = measurementAdapter({ detailOffset: value, rootFontSize: root });

		expect(measureMapFocusInset(map, adapter).rightOcclusion).toBeCloseTo(expected);
	});

	it('uses half the container height for a mounted sheet whose first rendered height is zero', () => {
		const { map } = mountedMap();
		const { adapter } = measurementAdapter({ detailOffset: '0rem', sheetHeight: 0 });

		expect(measureMapFocusInset(map, adapter)).toMatchObject({
			bottomOcclusion: 400,
			pointOffset: [0, -200],
			routePadding: { bottom: 464 },
		});
	});

	it('reads the target custom property and the portaled bottom-sheet height from the DOM', () => {
		const { hero, container, map } = mountedMap();
		hero.style.setProperty('--map-detail-offset', '3.7rem');
		document.documentElement.style.fontSize = '20px';
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(1040, 800));
		const sheet = document.createElement('div');
		sheet.dataset.slot = 'bottom-sheet';
		vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(rect(420, 320));
		document.body.append(sheet);

		expect(measureMapFocusInset(map)).toMatchObject({
			rightOcclusion: 74,
			bottomOcclusion: 320,
			pointOffset: [-37, -160],
		});
	});
});

describe('map focus inset deferral', () => {
	it('pins the exact tick then one-rAF implementation shape', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/mapFocusInset.ts'),
			'utf8',
		);

		expect(source).toMatch(
			/const container = map\.getContainer\(\);\s*mapOwnerBoundary\([\s\S]*?release: async \(\) => \{\s*await tick\(\);\s*await new Promise<void>\(\(resolve\) => adapter\.requestFrame\(\(\) => resolve\(\)\)\);/u,
		);
	});

	it('waits for tick and exactly one frame so a same-turn mobile sheet is measured', async () => {
		const { map } = mountedMap();
		const setup = measurementAdapter({ detailOffset: '0rem', sheetHeight: null });
		const consume = vi.fn();

		deferMapFocusInset(map, consume, setup.adapter);
		expect(consume).not.toHaveBeenCalled();
		expect(setup.frames).toHaveLength(0);

		await tick();
		await Promise.resolve();
		expect(setup.frames).toHaveLength(1);
		setup.values.sheetHeight = 320;
		setup.frames.shift()!(0);
		await Promise.resolve();
		await Promise.resolve();

		expect(setup.adapter.requestFrame).toHaveBeenCalledTimes(1);
		expect(setup.adapter.containerRect).toHaveBeenCalledTimes(1);
		expect(setup.adapter.detailOffset).toHaveBeenCalledTimes(1);
		expect(setup.adapter.rootFontSize).toHaveBeenCalledTimes(1);
		expect(setup.adapter.bottomSheetHeight).toHaveBeenCalledTimes(1);
		expect(consume).toHaveBeenCalledOnce();
		expect(consume.mock.calls[0]?.[0]).toMatchObject({
			bottomOcclusion: 320,
			pointOffset: [0, -160],
		});
	});

	it('lets only the latest deferred camera intent measure and move', async () => {
		const { map } = mountedMap();
		const first = measurementAdapter({ detailOffset: '300px' });
		const second = measurementAdapter({ detailOffset: '560px' });
		const firstConsume = vi.fn();
		const secondConsume = vi.fn();

		deferMapFocusInset(map, firstConsume, first.adapter);
		deferMapFocusInset(map, secondConsume, second.adapter);
		await tick();
		await Promise.resolve();
		expect(first.frames).toHaveLength(1);
		expect(second.frames).toHaveLength(1);

		first.frames.shift()!(0);
		second.frames.shift()!(0);
		await Promise.resolve();
		await Promise.resolve();

		expect(firstConsume).not.toHaveBeenCalled();
		expect(first.adapter.containerRect).not.toHaveBeenCalled();
		expect(secondConsume).toHaveBeenCalledOnce();
		expect(secondConsume.mock.calls[0]?.[0]).toMatchObject({ rightOcclusion: 560 });
	});

	it('captures the container before deferral and issues zero work when it detaches', async () => {
		const { hero, container } = mountedMap();
		const replacement = document.createElement('div');
		document.body.append(replacement);
		const getContainer = vi
			.fn<() => HTMLElement>()
			.mockReturnValueOnce(container)
			.mockReturnValue(replacement);
		const map = { getContainer };
		const setup = measurementAdapter();
		const consume = vi.fn();

		deferMapFocusInset(map, consume, setup.adapter);
		hero.remove();
		await reachFrame(setup.frames);

		expect(consume).not.toHaveBeenCalled();
		expect(setup.adapter.containerRect).not.toHaveBeenCalled();
		expect(getContainer).toHaveBeenCalledOnce();
	});

	it('reports a deferred scheduler failure exactly once', async () => {
		const { map } = mountedMap();
		const setup = measurementAdapter();
		const failure = new Error('frame scheduler failed');
		const report = vi.fn();
		const adapter: MapFocusMeasurementAdapter = {
			...setup.adapter,
			requestFrame: vi.fn(() => {
				throw failure;
			}),
		};

		deferMapFocusInset(map, vi.fn(), adapter, report);
		await tick();
		await Promise.resolve();
		await Promise.resolve();

		expect(report).toHaveBeenCalledExactlyOnceWith(failure);
	});
});
