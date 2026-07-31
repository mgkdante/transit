export type GeocodePrecision = 'address' | 'street' | 'neighbourhood' | 'postal' | 'place';

export type GeocodeSource = 'geo_ca' | 'google_places';

/**
 * The Montréal bias rectangle shared by Google Places locationRestriction,
 * the near-me coordinate guard, and the Place-Details bounds check.
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
	readonly lat?: number;
	readonly lon?: number;
	readonly label: string;
	readonly source: GeocodeSource;
	readonly precision: GeocodePrecision;
	readonly placeId?: string;
	readonly attribution?: 'google';
}

export interface GeocodedLocation extends GeocodeSuggestion {
	readonly lat: number;
	readonly lon: number;
	// Google autocomplete itself is coordinate-less until Place Details resolves it.
	readonly source: 'geo_ca' | 'google_places';
}

export function hasCoordinates(suggestion: GeocodeSuggestion): suggestion is GeocodedLocation {
	return typeof suggestion.lat === 'number' && typeof suggestion.lon === 'number';
}
