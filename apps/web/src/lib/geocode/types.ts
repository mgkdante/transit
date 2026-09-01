export type GeocodePrecision = 'address' | 'street' | 'neighbourhood' | 'postal' | 'place';

/**
 * The Montréal bounds shared by Geo.ca result filtering and the near-me
 * coordinate guard.
 */
export const MONTREAL_BOUNDS = {
	minLat: 45.35,
	maxLat: 45.75,
	minLon: -74.05,
	maxLon: -73.35,
} as const;

/** Is a coordinate inside the Montréal bias rectangle? */
export function isInsideMontrealBounds(lat: number, lon: number): boolean {
	return (
		lat >= MONTREAL_BOUNDS.minLat &&
		lat <= MONTREAL_BOUNDS.maxLat &&
		lon >= MONTREAL_BOUNDS.minLon &&
		lon <= MONTREAL_BOUNDS.maxLon
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
