export type GeocodePrecision = 'address' | 'street' | 'neighbourhood' | 'postal' | 'place';

export type GeocodeSource = 'geo_ca' | 'nominatim' | 'google_places';

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
	readonly source: 'geo_ca' | 'nominatim';
}

export function hasCoordinates(suggestion: GeocodeSuggestion): suggestion is GeocodedLocation {
	return typeof suggestion.lat === 'number' && typeof suggestion.lon === 'number';
}
