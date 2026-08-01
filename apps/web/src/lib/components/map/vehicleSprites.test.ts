import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OCCUPANCY_CODES, STATUS_CODES } from '$lib/v1/schemas';
import { STATUS_GLYPH, occupancyGlyph, occupancyVar, statusVar } from '$lib/components/dataviz';

import {
	BUS_FILL_TOKEN,
	BUS_HALO_TOKEN,
	BUS_ICON,
	HEADING_FILL_TOKEN,
	HEADING_HALO_TOKEN,
	HEADING_ICON,
	SILENT_FILL_TOKEN,
	SILENT_HALO_TOKEN,
	STOP_FILL_TOKEN,
	STOP_HALO_TOKEN,
	STOP_ICON,
	bakeVehicleSprites,
	countStateBadgePaintedPixels,
	stateBadgeIconId,
	VEHICLE_MARKER_GEOMETRY,
} from './vehicleSprites';

type DrawCommand = {
	method: string;
	args: unknown[];
	fillStyle: string;
	strokeStyle: string;
};

type LoggedImageData = ImageData & { commands: DrawCommand[] };

type Point = readonly [number, number];

const FIXED_TEST_ALPHA_PIXELS = 40;
const renderedImages: LoggedImageData[] = [];
let fixedAlphaSchedule: number[] = [];

function canvasContext(): CanvasRenderingContext2D {
	const commands: DrawCommand[] = [];
	const alphaPixels = fixedAlphaSchedule.shift() ?? FIXED_TEST_ALPHA_PIXELS;
	let fillStyle = '';
	let strokeStyle = '';
	let font = '';
	let globalCompositeOperation = 'source-over';
	const record = (method: string, ...args: unknown[]) =>
		commands.push({ method, args, fillStyle, strokeStyle });
	const context = {
		commands,
		set fillStyle(value: string) {
			fillStyle = value;
			record('setFillStyle', value);
		},
		set strokeStyle(value: string) {
			strokeStyle = value;
			record('setStrokeStyle', value);
		},
		get fillStyle() {
			return fillStyle;
		},
		get strokeStyle() {
			return strokeStyle;
		},
		set font(value: string) {
			font = value;
			record('setFont', value);
		},
		get font() {
			return font;
		},
		set globalCompositeOperation(value: string) {
			globalCompositeOperation = value;
			record('setGlobalCompositeOperation', value);
		},
		get globalCompositeOperation() {
			return globalCompositeOperation;
		},
		globalAlpha: 1,
		lineJoin: 'miter',
		lineCap: 'butt',
		lineWidth: 1,
		scale: (...args: unknown[]) => record('scale', ...args),
		beginPath: () => record('beginPath'),
		moveTo: (...args: unknown[]) => record('moveTo', ...args),
		lineTo: (...args: unknown[]) => record('lineTo', ...args),
		arcTo: (...args: unknown[]) => record('arcTo', ...args),
		arc: (...args: unknown[]) => record('arc', ...args),
		bezierCurveTo: (...args: unknown[]) => record('bezierCurveTo', ...args),
		closePath: () => record('closePath'),
		fill: () => record('fill'),
		stroke: () => record('stroke'),
		save: () => record('save'),
		restore: () => record('restore'),
		getImageData: (sx: number, sy: number, sw: number, sh: number) => {
			record('getImageData', sx, sy, sw, sh);
			const data = new Uint8ClampedArray(sw * sh * 4);
			for (let pixel = 0; pixel < alphaPixels; pixel += 1) {
				data[pixel * 4 + 3] = 255;
			}
			const image = {
				width: sw,
				height: sh,
				data,
				commands,
			} as LoggedImageData;
			renderedImages.push(image);
			return image;
		},
	};
	return context as unknown as CanvasRenderingContext2D;
}

function visibleDrawSignature(commands: DrawCommand[]): string {
	let fillStyle = '';
	let strokeStyle = '';
	let composite = 'source-over';
	let current: Point | null = null;
	let start: Point | null = null;
	let path: [string, unknown[]][] = [];
	let drawable = false;
	let subpathStartIndex = -1;
	let subpathDrawable = false;
	const stack: { fillStyle: string; strokeStyle: string; composite: string }[] = [];
	const draws: unknown[] = [];
	const samePoint = (left: Point | null, right: Point): boolean =>
		left !== null && left[0] === right[0] && left[1] === right[1];
	const resetPath = () => {
		current = null;
		start = null;
		path = [];
		drawable = false;
		subpathStartIndex = -1;
		subpathDrawable = false;
	};
	const discardPendingEmptySubpath = () => {
		if (subpathStartIndex >= 0 && !subpathDrawable) path.splice(subpathStartIndex);
	};

	for (const command of commands) {
		const { method, args } = command;
		if (method === 'setFillStyle') {
			fillStyle = String(args[0]);
			continue;
		}
		if (method === 'setStrokeStyle') {
			strokeStyle = String(args[0]);
			continue;
		}
		if (method === 'setGlobalCompositeOperation') {
			composite = String(args[0]);
			continue;
		}
		if (method === 'save') {
			stack.push({ fillStyle, strokeStyle, composite });
			continue;
		}
		if (method === 'restore') {
			const saved = stack.pop();
			if (saved) ({ fillStyle, strokeStyle, composite } = saved);
			continue;
		}
		if (method === 'beginPath') {
			resetPath();
			continue;
		}
		if (method === 'moveTo') {
			discardPendingEmptySubpath();
			const target = [Number(args[0]), Number(args[1])] as const;
			current = target;
			start = target;
			subpathStartIndex = path.length;
			subpathDrawable = false;
			path.push(['moveTo', [...args]]);
			continue;
		}
		if (method === 'lineTo') {
			const target = [Number(args[0]), Number(args[1])] as const;
			if (!current) {
				current = target;
				start = target;
				subpathStartIndex = path.length;
				subpathDrawable = false;
				path.push(['moveTo', [...args]]);
			} else if (!samePoint(current, target)) {
				path.push(['lineTo', [...args]]);
				current = target;
				drawable = true;
				subpathDrawable = true;
			}
			continue;
		}
		if (method === 'arc') {
			const radius = Number(args[2]);
			const startAngle = Number(args[3]);
			const endAngle = Number(args[4]);
			if (!(radius > 0) || startAngle === endAngle) continue;
			path.push(['arc', [...args]]);
			const end = [
				Number(args[0]) + radius * Math.cos(endAngle),
				Number(args[1]) + radius * Math.sin(endAngle),
			] as const;
			current = end;
			start ??= [
				Number(args[0]) + radius * Math.cos(startAngle),
				Number(args[1]) + radius * Math.sin(startAngle),
			];
			drawable = true;
			subpathDrawable = true;
			continue;
		}
		if (method === 'arcTo') {
			const first = [Number(args[0]), Number(args[1])] as const;
			const second = [Number(args[2]), Number(args[3])] as const;
			const radius = Number(args[4]);
			if (!current) {
				current = first;
				start = first;
				subpathStartIndex = path.length;
				subpathDrawable = false;
				path.push(['moveTo', [first[0], first[1]]]);
			} else if (!(radius > 0) || samePoint(current, first) || samePoint(first, second)) {
				if (!samePoint(current, first)) {
					path.push(['lineTo', [first[0], first[1]]]);
					current = first;
					drawable = true;
					subpathDrawable = true;
				}
			} else {
				path.push(['arcTo', [...args]]);
				current = second;
				drawable = true;
				subpathDrawable = true;
			}
			continue;
		}
		if (method === 'bezierCurveTo') {
			const end = [Number(args[4]), Number(args[5])] as const;
			const points = [
				[Number(args[0]), Number(args[1])] as const,
				[Number(args[2]), Number(args[3])] as const,
				end,
			];
			if (!current || points.some((point) => !samePoint(current, point))) {
				path.push(['bezierCurveTo', [...args]]);
				current = end;
				start ??= end;
				drawable = true;
				subpathDrawable = true;
			}
			continue;
		}
		if (method === 'closePath') {
			if (subpathDrawable) path.push(['closePath', []]);
			current = start;
			continue;
		}
		if ((method === 'fill' || method === 'stroke') && drawable) {
			const visiblePath =
				subpathStartIndex >= 0 && !subpathDrawable ? path.slice(0, subpathStartIndex) : path;
			draws.push({
				method,
				path: visiblePath,
				paint: method === 'fill' ? fillStyle : strokeStyle,
				composite,
			});
		}
	}

	return JSON.stringify(draws);
}

function bakeReceipt() {
	const images = new Map<string, LoggedImageData>();
	const map = {
		hasImage: (id: string) => images.has(id),
		removeImage: (id: string) => images.delete(id),
		addImage: (id: string, image: ImageData) => images.set(id, image as LoggedImageData),
	};
	const receipt = bakeVehicleSprites(map as never);
	return { images, receipt };
}

const resolvedColors = new Map<string, string>([
	['var(--background)', 'rgb(20, 20, 20)'],
	['var(--primary)', 'rgb(224, 120, 0)'],
	['var(--foreground)', 'rgb(245, 245, 245)'],
	['var(--map-stop-fill)', 'rgb(255, 182, 39)'],
]);
for (const [index, code] of STATUS_CODES.entries()) {
	resolvedColors.set(statusVar(code), `rgb(${30 + index}, ${70 + index}, ${110 + index})`);
}
for (const [index, code] of OCCUPANCY_CODES.entries()) {
	resolvedColors.set(occupancyVar(code), `rgb(${140 + index}, ${80 + index}, ${190 + index})`);
}

beforeEach(() => {
	renderedImages.length = 0;
	fixedAlphaSchedule = [];
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext());
	vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((node) => {
		const color = resolvedColors.get((node as HTMLElement).style.color);
		return { color: color ?? 'rgb(0, 0, 0)' } as CSSStyleDeclaration;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('vehicle sprite palette contract', () => {
	it('keeps buses orange while stops use the dedicated map-stop fill with the same outline token as buses', () => {
		expect(BUS_FILL_TOKEN).toBe('var(--primary)');
		expect(BUS_HALO_TOKEN).toBe('var(--background)');
		expect(STOP_FILL_TOKEN).toBe('var(--map-stop-fill)');
		expect(STOP_HALO_TOKEN).toBe(BUS_HALO_TOKEN);
		expect(STOP_FILL_TOKEN).not.toBe(BUS_FILL_TOKEN);
	});

	it('paints the directional chevron with a neutral foreground tick so it reads on any bus colour', () => {
		// ONE chevron sprite, rotated per-feature by the layer — neutral so it
		// contrasts on every (orange / status / occupancy) bus fill.
		expect(HEADING_FILL_TOKEN).toBe('var(--foreground)');
		expect(HEADING_HALO_TOKEN).toBe(BUS_HALO_TOKEN);
	});

	it('keeps a single consolidated bus sprite plus a stop pin and a heading chevron with distinct ids', () => {
		// One bus glyph (no directional variants), one stop pin, one chevron.
		const ids = [BUS_ICON, STOP_ICON, HEADING_ICON];
		expect(new Set(ids).size).toBe(ids.length);
		expect(BUS_ICON).toBe('veh-bus');
		expect(STOP_ICON).toBe('veh-stop');
		expect(HEADING_ICON).toBe('veh-heading');
	});
});

describe('vehicle sprite glyph vocabulary boundary', () => {
	it('imports and uses only the dataviz owner helpers without quoted glyph copies', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/map/vehicleSprites.ts'),
			'utf8',
		);
		const datavizImport = source.match(
			/import\s*\{([^}]+)\}\s*from ['"]\$lib\/components\/dataviz['"];/u,
		);
		expect(datavizImport?.[1]).toMatch(/\bSTATUS_GLYPH\b/u);
		expect(datavizImport?.[1]).toMatch(/\boccupancyGlyph\b/u);
		expect(source).not.toMatch(/\bOCCUPANCY_GLYPH\b/u);

		const productionBody = source.replace(datavizImport?.[0] ?? '', '');
		expect(productionBody).toMatch(/\bSTATUS_GLYPH\b/u);
		expect(productionBody).toMatch(/\boccupancyGlyph\b/u);

		const ownerGlyphs = [
			...Object.values(STATUS_GLYPH),
			...OCCUPANCY_CODES.map((code) => occupancyGlyph(code)),
		];
		for (const glyph of new Set(ownerGlyphs)) {
			const escaped = glyph.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
			expect(source).not.toMatch(new RegExp(`(['"])${escaped}\\1`, 'u'));
		}
	});
});

describe('vehicle state badge baker', () => {
	it('registers exactly one reachable vector badge for every schema state and never a no-data badge', () => {
		const { images, receipt } = bakeReceipt();
		const ids = [
			...STATUS_CODES.map((code) => stateBadgeIconId('status', code)),
			...OCCUPANCY_CODES.map((code) => stateBadgeIconId('occupancy', code)),
		];

		expect(ids).toEqual([
			'veh-m-s-early',
			'veh-m-s-on_time',
			'veh-m-s-late',
			'veh-m-s-severe',
			'veh-m-s-unknown',
			'veh-m-o-empty',
			'veh-m-o-many_seats',
			'veh-m-o-few_seats',
			'veh-m-o-standing',
			'veh-m-o-full',
		]);
		expect([...images.keys()].filter((id) => id.startsWith('veh-m-'))).toEqual(ids);
		expect(Object.keys(receipt)).toEqual([
			'stateBadges',
			'stateBadgeImages',
			'stateGlyphMasks',
			'stateGlyphMaskImages',
		]);
		expect(Object.keys(receipt.stateBadges)).toEqual(ids);
		expect(Object.keys(receipt.stateBadgeImages)).toEqual(ids);
		expect(Object.keys(receipt.stateGlyphMasks)).toEqual(ids);
		expect(Object.keys(receipt.stateGlyphMaskImages)).toEqual(ids);
		expect(receipt.stateBadges).toEqual({
			'veh-m-s-early': 3.6,
			'veh-m-s-on_time': 3.6,
			'veh-m-s-late': 3.6,
			'veh-m-s-severe': 3.6,
			'veh-m-s-unknown': 3.6,
			'veh-m-o-empty': 3.6,
			'veh-m-o-many_seats': 3.6,
			'veh-m-o-few_seats': 3.6,
			'veh-m-o-standing': 3.6,
			'veh-m-o-full': 3.6,
		});
		expect(receipt.stateGlyphMasks).toEqual(receipt.stateBadges);
		expect(Object.isFrozen(receipt)).toBe(true);
		expect(Object.isFrozen(receipt.stateBadges)).toBe(true);
		expect(Object.isFrozen(receipt.stateBadgeImages)).toBe(true);
		expect(Object.isFrozen(receipt.stateGlyphMasks)).toBe(true);
		expect(Object.isFrozen(receipt.stateGlyphMaskImages)).toBe(true);
		for (const id of ids) {
			expect(receipt.stateBadges[id]).toBe(countStateBadgePaintedPixels(images.get(id)!));
			expect(receipt.stateBadgeImages[id]).toBe(images.get(id));
			const glyphMask = receipt.stateGlyphMaskImages[id];
			expect(glyphMask).toBeDefined();
			expect(glyphMask).not.toBe(images.get(id));
			expect([...images.values()]).not.toContain(glyphMask);
			expect(receipt.stateGlyphMasks[id]).toBe(countStateBadgePaintedPixels(glyphMask!));
		}
		for (const id of ['veh-o-nodata', 'veh-m-o-nodata', 'veh-m-s-nodata']) {
			expect(images.has(id)).toBe(false);
		}
	});

	it('derives every receipt from a separate vector-only glyph mask rather than the registered plate', () => {
		fixedAlphaSchedule = [
			...Array<number>(10).fill(40),
			...Array.from({ length: 10 }, () => [20, 40]).flat(),
			...Array<number>(4).fill(40),
		];
		const { images, receipt } = bakeReceipt();
		const ids = [
			...STATUS_CODES.map((code) => stateBadgeIconId('status', code)),
			...OCCUPANCY_CODES.map((code) => stateBadgeIconId('occupancy', code)),
		];
		const glyphMasks = Array.from({ length: 10 }, (_, index) => renderedImages[11 + index * 2]);

		expect(renderedImages).toHaveLength(34);
		for (const [index, id] of ids.entries()) {
			expect(countStateBadgePaintedPixels(images.get(id)!)).toBe(1.8);
			expect(receipt.stateBadges[id]).toBe(1.8);
			expect(receipt.stateGlyphMasks[id]).toBe(3.6);
			expect(receipt.stateGlyphMaskImages[id]).toBe(glyphMasks[index]);
			expect(countStateBadgePaintedPixels(receipt.stateGlyphMaskImages[id]!)).toBe(3.6);
			const commands = glyphMasks[index]!.commands;
			expect(commands.some(({ method }) => method === 'beginPath')).toBe(true);
			expect(commands.some(({ method }) => method === 'fill')).toBe(true);
			expect(
				commands.some(({ method }) => ['fillText', 'strokeText', 'setFont'].includes(method)),
			).toBe(false);
		}
		expect(
			glyphMasks[4]!.commands.some(
				({ method, args }) =>
					method === 'setGlobalCompositeOperation' && args[0] === 'destination-out',
			),
		).toBe(true);
	});

	it('uses only the neutral silent-badge token pair while vector shape distinguishes every state', () => {
		const { images, receipt } = bakeReceipt();
		const expectModeBadges = <Code extends string>(
			mode: 'status' | 'occupancy',
			codes: readonly Code[],
		) => {
			const neutralColors = [
				resolvedColors.get(SILENT_FILL_TOKEN),
				resolvedColors.get(SILENT_HALO_TOKEN),
			];
			const signatures = new Set<string>();
			for (const code of codes) {
				const id = stateBadgeIconId(mode, code);
				const commands = images.get(id)!.commands;
				const glyphCommands = (receipt.stateGlyphMaskImages[id] as LoggedImageData).commands;
				expect(commands.some(({ method }) => method === 'beginPath')).toBe(true);
				expect(
					commands.some(({ method }) => ['moveTo', 'lineTo', 'arc', 'arcTo'].includes(method)),
				).toBe(true);
				expect(commands.some(({ method }) => ['fillText', 'strokeText'].includes(method))).toBe(
					false,
				);
				expect(commands.some(({ method }) => method === 'setFont')).toBe(false);
				expect(
					commands
						.filter(({ method }) => method === 'setFillStyle' || method === 'setStrokeStyle')
						.map(({ args }) => args[0]),
				).toEqual(expect.arrayContaining(neutralColors));
				expect(
					commands
						.filter(({ method }) => method === 'setFillStyle' || method === 'setStrokeStyle')
						.every(({ args }) => neutralColors.includes(args[0] as string)),
				).toBe(true);
				signatures.add(visibleDrawSignature(glyphCommands));
			}
			expect(signatures.size).toBe(codes.length);
		};

		expectModeBadges('status', STATUS_CODES);
		expectModeBadges('occupancy', OCCUPANCY_CODES);

		const onTime = (
			receipt.stateGlyphMaskImages[stateBadgeIconId('status', 'on_time')] as LoggedImageData
		).commands;
		expect(
			onTime.some(
				({ method, args }) =>
					method === 'arc' &&
					args[0] === 13 &&
					args[1] === 13 &&
					Number(args[2]) > 0 &&
					Number(args[3]) !== Number(args[4]),
			),
		).toBe(true);

		const command = (method: string, args: unknown[] = []): DrawCommand => ({
			method,
			args,
			fillStyle: '',
			strokeStyle: '',
		});
		const triangle = [
			command('beginPath'),
			command('moveTo', [13, 18]),
			command('lineTo', [8, 9]),
			command('lineTo', [18, 9]),
			command('closePath'),
			command('fill'),
		];
		const triangleWithEmptySubpath = [
			triangle[0]!,
			command('moveTo', [0, 0]),
			...triangle.slice(1),
		];
		expect(visibleDrawSignature(triangleWithEmptySubpath)).toBe(visibleDrawSignature(triangle));
	});

	it('exports the immutable frozen marker geometry used by the next map layer and full-size badge baker', () => {
		expect(VEHICLE_MARKER_GEOMETRY).toEqual({
			box: 26,
			bodyIconSize: { z11: 0.78, z15: 1.3 },
			stateBadge: { offset: [0, 20], scale: 0.6 },
			silentBadge: { offset: [0, -16], scale: 0.75 },
			chevronAnnulus: { inner: 4.9, outer: 10.8 },
			plateMargin: 2.4,
		});
		expect(Object.isFrozen(VEHICLE_MARKER_GEOMETRY)).toBe(true);
		expect(Object.isFrozen(VEHICLE_MARKER_GEOMETRY.stateBadge.offset)).toBe(true);

		const { images } = bakeReceipt();
		const plateMove = images
			.get('veh-m-s-early')!
			.commands.find(({ method }) => method === 'moveTo')!;
		expect(plateMove.args).toEqual([8.336, 2.4]);
	});

	it('counts only opaque ImageData pixels after DPR normalization and frozen badge scaling', () => {
		const data = new Uint8ClampedArray(52 * 52 * 4);
		for (const pixel of [0, 1, 2, 3, 4, 5, 6, 7]) data[pixel * 4 + 3] = 255;
		data[8 * 4 + 0] = 255;

		expect(countStateBadgePaintedPixels({ width: 52, height: 52, data } as ImageData)).toBe(0.72);
	});
});
