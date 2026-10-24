import type { GeocodePrecision } from '$lib/geocode/types';
import { resolveColor } from './vehicleSprites';

export interface NearTarget {
	readonly lat: number;
	readonly lon: number;
	readonly label: string;
	readonly precision?: GeocodePrecision;
}

const PIN_WIDTH = 44;
const PIN_HEIGHT = 60;
const PIN_RATIO = 2;

export function bakeLocationPinImage(): ImageData {
	if (typeof document === 'undefined') throw new Error('Location pin requires a browser canvas');
	const fill = resolveColor('var(--accent-text)', 'rgb(255, 182, 39)');
	const halo = resolveColor('var(--background)', 'rgb(20, 20, 20)');
	const inner = resolveColor('var(--card)', 'rgb(255, 255, 255)');
	return pinImage(fill, halo, inner);
}

function pinImage(fill: string, halo: string, inner: string): ImageData {
	const pxWidth = PIN_WIDTH * PIN_RATIO;
	const pxHeight = PIN_HEIGHT * PIN_RATIO;
	const canvas = document.createElement('canvas');
	canvas.width = pxWidth;
	canvas.height = pxHeight;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('[nearTargetLayer] 2D canvas context unavailable');
	ctx.scale(PIN_RATIO, PIN_RATIO);

	const c = PIN_WIDTH / 2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.lineWidth = 4.5;
	ctx.strokeStyle = halo;
	ctx.fillStyle = fill;
	drawPinPath(ctx, c);
	ctx.fill();
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(c, 20, 6.5, 0, Math.PI * 2);
	ctx.fillStyle = inner;
	ctx.fill();
	ctx.lineWidth = 1.4;
	ctx.strokeStyle = halo;
	ctx.stroke();

	return ctx.getImageData(0, 0, pxWidth, pxHeight);
}

function drawPinPath(ctx: CanvasRenderingContext2D, c: number): void {
	ctx.beginPath();
	ctx.moveTo(c, PIN_HEIGHT - 3);
	ctx.bezierCurveTo(c - 3.5, PIN_HEIGHT - 12, 6, 34, 6, 21);
	ctx.bezierCurveTo(6, 9, 15, 3.5, c, 3.5);
	ctx.bezierCurveTo(PIN_WIDTH - 6, 3.5, PIN_WIDTH - 6, 9, PIN_WIDTH - 6, 21);
	ctx.bezierCurveTo(PIN_WIDTH - 6, 34, c + 3.5, PIN_HEIGHT - 12, c, PIN_HEIGHT - 3);
	ctx.closePath();
}
