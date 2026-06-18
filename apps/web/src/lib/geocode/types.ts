export type GeocodePrecision = 'address' | 'street' | 'neighbourhood' | 'postal' | 'place';

export type GeocodeSource = 'geo_ca' | 'nominatim' | 'google_places';

/**
 * The Montréal bias rectangle shared by every geocode provider (Google Places
 * locationRestriction, the Nominatim viewbox, the near-me coordinate guard) and
 * the Place-Details bounds check. ONE source of truth — was duplicated across
 * googlePlaces.ts / nominatim.ts / mapNear.ts / MapHero.svelte.
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

/** Nominatim `viewbox` string (lon,lat order: left,top,right,bottom). */
export function montrealViewbox(): string {
	return `${MONTREAL_BOUNDS.minLon},${MONTREAL_BOUNDS.maxLat},${MONTREAL_BOUNDS.maxLon},${MONTREAL_BOUNDS.minLat}`;
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
	// google_places joins geo_ca/nominatim once a Place-Details call resolves a
	// placeId to exact coordinates (Google autocomplete itself is coordinate-less).
	readonly source: 'geo_ca' | 'nominatim' | 'google_places';
}

export function hasCoordinates(suggestion: GeocodeSuggestion): suggestion is GeocodedLocation {
	return typeof suggestion.lat === 'number' && typeof suggestion.lon === 'number';
}
