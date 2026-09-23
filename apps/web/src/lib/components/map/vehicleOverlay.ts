import type { Map as MapLibreMap, PointLike } from 'maplibre-gl';
import { VEHICLE_HIGHLIGHT_STYLE, type VehicleFC, type VehicleFeature } from './vehicleLayer';
import type { NearTarget } from './nearTargetLayer';
import {
	BUS_ICON,
	HEADING_ICON,
	SILENT_ICON,
	VEHICLE_MARKER_GEOMETRY,
	resolveColor,
	type VehicleSpriteReceipt,
} from './vehicleSprites';

/** Private browser receipt; a property getter adds no per-frame DOM mutation. */
export const VEHICLE_OVERLAY_RECEIPT = Symbol.for('transit.map.vehicleOverlayReceipt');

export interface VehicleOverlayReceipt {
	readonly generation: number;
	readonly drawSequence: number;
	readonly projectedCount: number;
	readonly paintedBodyCount: number;
	readonly transform: string;
	readonly drawable: boolean;
	readonly destroyed: boolean;
}

export interface VehicleOverlay {
	readonly receipt: VehicleOverlayReceipt;
	draw(features: VehicleFC): void;
	redraw(): void;
	setScene(
		stale: boolean,
		nearTarget: NearTarget | null,
		hoveredId: string | null,
		selectedId: string | null,
	): boolean;
	setSprites(sprites: VehicleSpriteReceipt, pin: ImageData): void;
	pick(point: PointLike): string | null;
	hold(): void;
	resume(): void;
	destroy(): void;
}

interface BodyHit {
	id: string;
	left: number;
	top: number;
	right: number;
	bottom: number;
}

interface ProjectedVehicle {
	feature: VehicleFeature;
	index: number;
	x: number;
	y: number;
	baseSize: number;
	bodySizeFactor: number;
}

const BOX = VEHICLE_MARKER_GEOMETRY.box;
const ICON_PADDING = 2; // MapLibre 6.4.1's default symbol icon-padding.
const RAD = Math.PI / 180;
let nextGeneration = 0;

function lerp(value: number, from: number, to: number, first: number, last: number): number {
	const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
	return first + (last - first) * t;
}

function sameTarget(a: NearTarget | null, b: NearTarget | null): boolean {
	return (
		a?.lat === b?.lat && a?.lon === b?.lon && a?.label === b?.label && a?.precision === b?.precision
	);
}

function imageCanvas(image: ImageData): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = image.width;
	canvas.height = image.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Map overlay sprite canvas unavailable');
	context.putImageData(image, 0, 0);
	return canvas;
}

function spriteAtlas(sprites: VehicleSpriteReceipt): ReadonlyMap<string, HTMLCanvasElement> {
	return new Map(
		Object.entries(sprites.sprites).map(([id, image]) => {
			if (image.width !== BOX * sprites.pixelRatio || image.height !== BOX * sprites.pixelRatio) {
				throw new Error(`Map overlay sprite ${id} has an unexpected backing size`);
			}
			return [id, imageCanvas(image)];
		}),
	);
}

/** The app-owned moving foreground; MapLibre still owns projection and static layers. */
export function createVehicleOverlay(
	map: MapLibreMap,
	sprites: VehicleSpriteReceipt,
	pin: ImageData,
	onPaint?: (receipt: VehicleOverlayReceipt) => void,
	onUnavailable?: () => void,
): VehicleOverlay {
	const glCanvas = map.getCanvas();
	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.dataset.slot = 'vehicle-overlay';
	canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Map overlay 2D context unavailable');
	const ctx: CanvasRenderingContext2D = context;
	let spriteBytes = sprites;
	let pinBytes = pin;
	let atlas = spriteAtlas(spriteBytes);
	let pinCanvas = imageCanvas(pinBytes);
	let highlightCasing = resolveColor(VEHICLE_HIGHLIGHT_STYLE.casingToken, 'rgb(20, 20, 20)');
	let highlightRing = resolveColor(VEHICLE_HIGHLIGHT_STYLE.ringToken, 'rgb(255, 95, 87)');
	let features: VehicleFC = { type: 'FeatureCollection', features: [] };
	let stale = false;
	let nearTarget: NearTarget | null = null;
	let hoveredId: string | null = null;
	let selectedId: string | null = null;
	let mapLost = false;
	let canvasLost = false;
	let stopping = false;
	let destroyed = false;
	let renderListenerPending = false;
	let lossListenerPending = false;
	let canvasLossListenerPending = false;
	let canvasRestoreListenerPending = false;
	let canvasPending = false;
	let transform = '';
	let hits: BodyHit[] = [];
	const generation = ++nextGeneration;
	let receipt: VehicleOverlayReceipt = {
		generation,
		drawSequence: 0,
		projectedCount: 0,
		paintedBodyCount: 0,
		transform: '',
		drawable: false,
		destroyed: false,
	};
	Object.defineProperty(canvas, VEHICLE_OVERLAY_RECEIPT, { get: () => receipt });

	function transformKey(): string {
		const center = map.getCenter();
		const padding = map.getPadding();
		return [
			glCanvas.width,
			glCanvas.height,
			glCanvas.style.width,
			glCanvas.style.height,
			center.lng,
			center.lat,
			map.getZoom(),
			map.getBearing(),
			map.getPitch(),
			map.getRoll(),
			map.getVerticalFieldOfView(),
			padding.top,
			padding.right,
			padding.bottom,
			padding.left,
		].join('|');
	}

	function sizeCanvas(): { width: number; height: number } {
		const width = Number.parseFloat(glCanvas.style.width) || glCanvas.getBoundingClientRect().width;
		const height =
			Number.parseFloat(glCanvas.style.height) || glCanvas.getBoundingClientRect().height;
		if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
		if (canvas.width !== glCanvas.width || canvas.height !== glCanvas.height) {
			canvas.width = glCanvas.width;
			canvas.height = glCanvas.height;
		}
		const cssWidth = `${width}px`;
		const cssHeight = `${height}px`;
		if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
		if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
		ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
		ctx.imageSmoothingEnabled = true;
		return { width, height };
	}

	function depthRatio(y: number, height: number): number {
		const pitch = map.getPitch();
		if (pitch === 0) return 1;
		const fov = map.getVerticalFieldOfView() * RAD;
		const cameraDistance = height / (2 * Math.tan(fov / 2));
		const padding = map.getPadding();
		const centerY = height / 2 + ((padding.top ?? 0) - (padding.bottom ?? 0)) / 2;
		return 1 + (Math.tan(pitch * RAD) * (y - centerY)) / cameraDistance;
	}

	function viewportPitchScale(y: number, height: number): number {
		return Math.max(0, Math.min(4, 0.5 + 0.5 * depthRatio(y, height)));
	}

	function collisionHalfBox(y: number, height: number, zoom: number): number {
		// MapLibre lays symbol collision boxes out at the tile bucket's next zoom.
		// The bucket can lag camera zoom, so edge parity is a browser gate.
		const layoutSize = lerp(
			Math.floor(zoom) + 1,
			11,
			15,
			VEHICLE_MARKER_GEOMETRY.bodyIconSize.z11,
			VEHICLE_MARKER_GEOMETRY.bodyIconSize.z15,
		);
		return ((BOX / 2) * layoutSize + ICON_PADDING) * (0.5 + 0.5 * depthRatio(y, height));
	}

	function headingAngle(
		feature: VehicleFeature,
		x: number,
		y: number,
		width: number,
		height: number,
	): number {
		const bearing = feature.properties.bearing * RAD;
		const cameraBearing = map.getBearing() * RAD;
		const pitch = map.getPitch() * RAD;
		if (pitch === 0 && map.getRoll() === 0) return bearing - cameraBearing;
		if (map.getRoll() !== 0) {
			const [lon, lat] = feature.geometry.coordinates;
			const west = map.project([lon - 0.00001, lat]);
			const east = map.project([lon + 0.00001, lat]);
			return bearing + Math.atan2(east.y - west.y, east.x - west.x);
		}
		const padding = map.getPadding();
		const centerX = width / 2 + ((padding.left ?? 0) - (padding.right ?? 0)) / 2;
		const fov = map.getVerticalFieldOfView() * RAD;
		const cameraDistance = height / (2 * Math.tan(fov / 2));
		const depth = depthRatio(y, height);
		const eastX =
			Math.cos(cameraBearing) -
			((x - centerX) / cameraDistance) * Math.sin(pitch) * Math.sin(cameraBearing);
		const eastY = -depth * Math.cos(pitch) * Math.sin(cameraBearing);
		return bearing + Math.atan2(eastY, eastX);
	}

	function drawSprite(id: string, x: number, y: number, size: number, opacity: number): boolean {
		const image = atlas.get(id);
		if (!image) return false;
		ctx.globalAlpha = opacity;
		ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
		return true;
	}

	function opacityFor(feature: VehicleFeature): number {
		const id = feature.properties.id;
		return id === hoveredId
			? 1
			: id === selectedId || feature.properties.selected === 1
				? 0.95
				: stale
					? 0.45
					: 1;
	}

	function paint(): void {
		if (destroyed || stopping || mapLost || canvasLost) return;
		if (typeof ctx.isContextLost === 'function' && ctx.isContextLost()) {
			canvasLost = true;
			suspend();
			return;
		}
		const { width, height } = sizeCanvas();
		if (!width || !height) return;
		transform = transformKey();
		ctx.clearRect(0, 0, width, height);
		hits = [];
		const zoom = map.getZoom();
		const baseSize = lerp(
			zoom,
			11,
			15,
			VEHICLE_MARKER_GEOMETRY.bodyIconSize.z11,
			VEHICLE_MARKER_GEOMETRY.bodyIconSize.z15,
		);
		const projected: ProjectedVehicle[] = features.features.map((feature, index) => {
			const [lon, lat] = feature.geometry.coordinates;
			const point = map.project([lon, lat]);
			return {
				feature,
				index,
				x: point.x,
				y: point.y,
				baseSize,
				bodySizeFactor: baseSize * viewportPitchScale(point.y, height),
			};
		});
		const visible = projected.filter(
			({ feature, x, y }) =>
				feature.properties.matched === 1 &&
				Number.isFinite(x) &&
				Number.isFinite(y) &&
				x >= -BOX * 4 &&
				y >= -BOX * 4 &&
				x <= width + BOX * 4 &&
				y <= height + BOX * 4,
		);
		// MapLibre's overlap-enabled point symbols sort by rotated tile Y, then
		// descending source index. Screen Y preserves that order within a flat tile;
		// cross-tile and quantized ties remain native parity gates.
		const symbols = [...visible].sort((a, b) => a.y - b.y || b.index - a.index);

		// Match MapLibre's layer-wide order, not one complete marker per vehicle.
		for (const { feature, x, y } of visible) {
			const hovered = feature.properties.id === hoveredId;
			const selected = feature.properties.id === selectedId;
			if (!hovered && !selected) continue;
			const circleScale = Math.max(0, depthRatio(y, height));
			const radius = lerp(zoom, 11, 15, hovered ? 15 : 13, hovered ? 22 : 19) * circleScale;
			const strokeWidth =
				(hovered
					? VEHICLE_HIGHLIGHT_STYLE.hoverStrokeWidth
					: VEHICLE_HIGHLIGHT_STYLE.selectedStrokeWidth) * circleScale;
			ctx.globalAlpha = hovered
				? VEHICLE_HIGHLIGHT_STYLE.hoverOpacity
				: VEHICLE_HIGHLIGHT_STYLE.selectedOpacity;
			ctx.beginPath();
			ctx.arc(x, y, radius, 0, Math.PI * 2);
			ctx.fillStyle = highlightCasing;
			ctx.fill();
			ctx.globalAlpha = 1;
			ctx.beginPath();
			ctx.arc(x, y, radius + strokeWidth / 2, 0, Math.PI * 2);
			ctx.lineWidth = strokeWidth;
			ctx.strokeStyle = highlightRing;
			ctx.stroke();
		}
		for (const { feature, x, y, bodySizeFactor } of symbols) {
			const bodySize = BOX * bodySizeFactor;
			if (!drawSprite(feature.properties.body || BUS_ICON, x, y, bodySize, opacityFor(feature)))
				continue;
			const halfBox = collisionHalfBox(y, height, zoom);
			if (halfBox > 0)
				hits.push({
					id: feature.properties.id,
					left: x - halfBox,
					top: y - halfBox,
					right: x + halfBox,
					bottom: y + halfBox,
				});
		}
		for (const { feature, x, y, baseSize } of symbols) {
			if (feature.properties.hasHeading !== 1) continue;
			const angle = headingAngle(feature, x, y, width, height);
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(angle);
			drawSprite(
				HEADING_ICON,
				VEHICLE_MARKER_GEOMETRY.headingOffset[0] * baseSize,
				VEHICLE_MARKER_GEOMETRY.headingOffset[1] * baseSize,
				BOX * baseSize,
				opacityFor(feature),
			);
			ctx.restore();
		}
		for (const { feature, x, y, baseSize } of symbols) {
			const mark = feature.properties.mark;
			if (!mark) continue;
			const offset = feature.properties.stale
				? VEHICLE_MARKER_GEOMETRY.stateBadge.pairedOffset
				: VEHICLE_MARKER_GEOMETRY.stateBadge.offset;
			drawSprite(
				mark,
				x + offset[0] * baseSize,
				y + offset[1] * baseSize,
				BOX * baseSize * VEHICLE_MARKER_GEOMETRY.stateBadge.scale,
				opacityFor(feature),
			);
		}
		for (const { feature, x, y, baseSize } of symbols) {
			if (feature.properties.stale !== 1) continue;
			const offset = feature.properties.mark
				? VEHICLE_MARKER_GEOMETRY.silentBadge.pairedOffset
				: VEHICLE_MARKER_GEOMETRY.silentBadge.offset;
			drawSprite(
				SILENT_ICON,
				x + offset[0] * baseSize,
				y + offset[1] * baseSize,
				BOX * baseSize * VEHICLE_MARKER_GEOMETRY.silentBadge.scale,
				1,
			);
		}
		if (nearTarget) {
			const point = map.project([nearTarget.lon, nearTarget.lat]);
			const pinSize =
				(zoom < 13 ? lerp(zoom, 9, 13, 0.82, 1.03) : lerp(zoom, 13, 17, 1.03, 1.18)) *
				viewportPitchScale(point.y, height);
			const pinWidth = (pinCanvas.width / 2) * pinSize;
			const pinHeight = (pinCanvas.height / 2) * pinSize;
			ctx.globalAlpha = 1;
			ctx.drawImage(pinCanvas, point.x - pinWidth / 2, point.y - pinHeight, pinWidth, pinHeight);
		}
		ctx.globalAlpha = 1;
		receipt = {
			generation,
			drawSequence: receipt.drawSequence + 1,
			projectedCount: projected.length,
			paintedBodyCount: hits.length,
			transform,
			drawable: true,
			destroyed: false,
		};
		onPaint?.(receipt);
	}

	function suspend(): void {
		hits = [];
		canvas.style.visibility = 'hidden';
		receipt = { ...receipt, paintedBodyCount: 0, drawable: false };
		onUnavailable?.();
	}

	const onRender = () => {
		if (!mapLost && !canvasLost && !stopping && transformKey() !== transform) paint();
	};
	const onLost = () => {
		mapLost = true;
		suspend();
	};
	const onCanvasLost = () => {
		canvasLost = true;
		suspend();
	};
	const onCanvasRestored = () => {
		canvasLost = false;
		atlas = spriteAtlas(spriteBytes);
		pinCanvas = imageCanvas(pinBytes);
		if (mapLost || stopping) return;
		canvas.style.visibility = '';
		paint();
	};
	const overlay: VehicleOverlay = {
		get receipt() {
			return receipt;
		},
		draw(next) {
			features = next;
			paint();
		},
		redraw: paint,
		setScene(nextStale, target, hovered, selected) {
			const changed =
				stale !== nextStale ||
				!sameTarget(nearTarget, target) ||
				hoveredId !== hovered ||
				selectedId !== selected;
			stale = nextStale;
			nearTarget = target;
			hoveredId = hovered;
			selectedId = selected;
			return changed;
		},
		setSprites(next, nextPin) {
			spriteBytes = next;
			pinBytes = nextPin;
			atlas = spriteAtlas(spriteBytes);
			pinCanvas = imageCanvas(pinBytes);
			highlightCasing = resolveColor(VEHICLE_HIGHLIGHT_STYLE.casingToken, 'rgb(20, 20, 20)');
			highlightRing = resolveColor(VEHICLE_HIGHLIGHT_STYLE.ringToken, 'rgb(255, 95, 87)');
		},
		pick(point) {
			if (mapLost || canvasLost || stopping || destroyed) return null;
			const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
			for (let index = hits.length - 1; index >= 0; index--) {
				const hit = hits[index];
				if (x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom) return hit.id;
			}
			return null;
		},
		hold() {
			mapLost = true;
			suspend();
		},
		resume() {
			if (stopping) return;
			mapLost = false;
			if (!canvasLost) canvas.style.visibility = '';
		},
		destroy() {
			if (destroyed) return;
			stopping = true;
			hits = [];
			const errors: unknown[] = [];
			if (renderListenerPending) {
				try {
					map.off('render', onRender);
					renderListenerPending = false;
				} catch (error) {
					errors.push(error);
				}
			}
			if (lossListenerPending) {
				try {
					map.off('webglcontextlost', onLost);
					lossListenerPending = false;
				} catch (error) {
					errors.push(error);
				}
			}
			if (canvasLossListenerPending) {
				try {
					canvas.removeEventListener('contextlost', onCanvasLost);
					canvasLossListenerPending = false;
				} catch (error) {
					errors.push(error);
				}
			}
			if (canvasRestoreListenerPending) {
				try {
					canvas.removeEventListener('contextrestored', onCanvasRestored);
					canvasRestoreListenerPending = false;
				} catch (error) {
					errors.push(error);
				}
			}
			if (canvasPending) {
				try {
					canvas.remove();
					canvasPending = false;
				} catch (error) {
					errors.push(error);
				}
			}
			destroyed =
				!renderListenerPending &&
				!lossListenerPending &&
				!canvasLossListenerPending &&
				!canvasRestoreListenerPending &&
				!canvasPending;
			if (destroyed) receipt = { ...receipt, drawable: false, destroyed: true };
			if (destroyed) onUnavailable?.();
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, 'Vehicle overlay cleanup failed');
		},
	};
	try {
		// Record ownership before each call: a host method may mutate then throw.
		canvasPending = true;
		map.getCanvasContainer().appendChild(canvas);
		canvasLossListenerPending = true;
		canvas.addEventListener('contextlost', onCanvasLost);
		canvasRestoreListenerPending = true;
		canvas.addEventListener('contextrestored', onCanvasRestored);
		renderListenerPending = true;
		map.on('render', onRender);
		lossListenerPending = true;
		map.on('webglcontextlost', onLost);
	} catch (error) {
		try {
			overlay.destroy();
		} catch (cleanupError) {
			throw Object.assign(
				new AggregateError([error, cleanupError], 'Map overlay installation cleanup failed'),
				{ overlay },
			);
		}
		throw error;
	}
	return overlay;
}
