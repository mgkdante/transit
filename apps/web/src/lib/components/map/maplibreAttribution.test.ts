import { AttributionControl, type Map as MapLibreMap } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';

const licence = 'https://creativecommons.org/licenses/by/4.0/';
const attribution =
	'<details open onload="void 0" ontoggle="void 0">Source</details>' +
	'<a href="javascript:void(0)" onclick="void 0">unsafe</a>' +
	`<a href="${licence}" target="_blank" rel="noopener">STM licence</a>`;

it.each(['custom', 'source'] as const)(
	'removes consecutive unsafe attributes from real %s attribution and keeps the licence',
	(origin) => {
		const map = {
			style: {
				tileManagers:
					origin === 'source'
						? { basemap: { used: true, getSource: () => ({ attribution }) } }
						: {},
			},
			_getUIString: () => 'Toggle attribution',
			getCanvasContainer: () => document.createElement('div'),
			on: vi.fn(),
			off: vi.fn(),
		} as unknown as MapLibreMap;
		const control = new AttributionControl({
			compact: true,
			...(origin === 'custom' ? { customAttribution: attribution } : {}),
		});
		const element = control.onAdd(map);
		try {
			const content = element.querySelector('.maplibregl-ctrl-attrib-inner')!;
			const details = content.querySelector('details')!;
			expect(details.hasAttribute('open')).toBe(true);
			expect(details.hasAttribute('onload')).toBe(false);
			expect(details.hasAttribute('ontoggle')).toBe(false);
			const [unsafe, safe] = content.querySelectorAll('a');
			expect(unsafe.hasAttribute('href')).toBe(false);
			expect(unsafe.hasAttribute('onclick')).toBe(false);
			expect(safe.getAttribute('href')).toBe(licence);
			expect(safe.textContent).toBe('STM licence');
			expect(safe.getAttribute('rel')).toBe('noopener');
		} finally {
			control.onRemove();
		}
	},
);
