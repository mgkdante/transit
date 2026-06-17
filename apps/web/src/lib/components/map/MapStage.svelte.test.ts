import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MapStage', () => {
	const source = () => readFileSync(resolve(process.cwd(), 'src/lib/components/map/MapStage.svelte'), 'utf-8');

	it('does not re-apply the same camera during chrome-only re-renders', () => {
		const s = source();

		expect(s).toContain('let activeCameraKey: string | null = null');
		expect(s).toContain('function cameraKey(nextCenter: [number, number], nextZoom: number): string');
		expect(s).toContain('const nextCameraKey = cameraKey(nextCenter, nextZoom)');
		expect(s).toContain('if (activeCameraKey === nextCameraKey) return');
		expect(s).toContain('activeCameraKey = nextCameraKey');
		expect(s).toContain('m.jumpTo({ center: nextCenter, zoom: nextZoom })');
	});
});
