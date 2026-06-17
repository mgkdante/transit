import { ROUTE_LINE_HIT_LAYER, STOPS_LAYER, VEHICLE_BODY_LAYER } from '$lib/components/map';
import type { MapSelection } from './mapSelection';

export const PICKABLE_MAP_LAYERS = [
	VEHICLE_BODY_LAYER,
	STOPS_LAYER,
	ROUTE_LINE_HIT_LAYER,
] as const;

export interface PickableMapFeature {
	readonly layer?: { readonly id?: string };
	readonly properties?: Readonly<Record<string, unknown>> | null;
}

function stringProperty(feature: PickableMapFeature, key: string): string | null {
	const raw = feature.properties?.[key];
	if (raw == null) return null;
	const value = String(raw);
	return value.length > 0 ? value : null;
}

function numericProperty(feature: PickableMapFeature, key: string): number | null {
	const raw = feature.properties?.[key];
	const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
	return Number.isFinite(value) ? value : null;
}

export function selectionFromFeature(feature: PickableMapFeature): MapSelection | null {
	const layerId = feature.layer?.id;
	if (layerId === VEHICLE_BODY_LAYER) {
		const id = stringProperty(feature, 'id');
		return id ? { kind: 'vehicle', id } : null;
	}

	if (layerId === STOPS_LAYER) {
		const id = stringProperty(feature, 'id');
		return id ? { kind: 'stop', id } : null;
	}

	if (layerId === ROUTE_LINE_HIT_LAYER) {
		const id = stringProperty(feature, 'route_id');
		if (!id) return null;
		return {
			kind: 'route',
			id,
			direction: numericProperty(feature, 'direction'),
			variantKey: stringProperty(feature, 'variant_key'),
		};
	}

	return null;
}

export function pickMapSelection(features: readonly PickableMapFeature[]): MapSelection | null {
	for (const layer of PICKABLE_MAP_LAYERS) {
		for (const feature of features) {
			if (feature.layer?.id !== layer) continue;
			const selection = selectionFromFeature(feature);
			if (selection) return selection;
		}
	}
	return null;
}
