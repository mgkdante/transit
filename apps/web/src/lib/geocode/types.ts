export type GeocodePrecision = 'address' | 'street' | 'neighbourhood' | 'postal' | 'place';

export interface GeocodeArea {
	readonly bbox: readonly number[];
	readonly context: string;
	readonly lang: 'en' | 'fr';
}

export function isInsideBounds(lat: number, lon: number, bbox: readonly number[]): boolean {
	return (
		Number.isFinite(lat) &&
		Number.isFinite(lon) &&
		lat >= bbox[1] &&
		lat <= bbox[3] &&
		lon >= bbox[0] &&
		lon <= bbox[2]
	);
}

export interface GeocodeSuggestion {
	readonly lat: number;
	readonly lon: number;
	readonly label: string;
	readonly source: 'geo_ca';
	readonly precision: GeocodePrecision;
}

export type GeocodedLocation = GeocodeSuggestion;
