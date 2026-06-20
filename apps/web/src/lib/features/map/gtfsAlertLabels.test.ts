import { describe, expect, it } from 'vitest';
import { causeLabel, effectLabel } from './gtfsAlertLabels';

describe('causeLabel', () => {
	it('maps known GTFS-RT causes to bilingual labels', () => {
		expect(causeLabel('CONSTRUCTION', 'en')).toBe('Construction');
		expect(causeLabel('CONSTRUCTION', 'fr')).toBe('Travaux');
		expect(causeLabel('MEDICAL_EMERGENCY', 'en')).toBe('Medical emergency');
		expect(causeLabel('MEDICAL_EMERGENCY', 'fr')).toBe('Urgence médicale');
	});

	it('humanizes an unknown/vendor cause instead of showing it raw', () => {
		expect(causeLabel('POLICE_ACTIVITY', 'en')).toBe('Police activity');
		expect(causeLabel('POLICE_ACTIVITY', 'fr')).toBe('Activité policière');
		// A vendor extension we have no mapping for is still humanized, never
		// shown raw-uppercase-with-underscores.
		expect(causeLabel('SPECIAL_EVENT', 'en')).toBe('Special event');
		expect(causeLabel('SPECIAL_EVENT', 'fr')).toBe('Special event');
	});

	it('renders nothing for uninformative or absent causes', () => {
		expect(causeLabel('UNKNOWN_CAUSE', 'en')).toBeNull();
		expect(causeLabel('OTHER_CAUSE', 'fr')).toBeNull();
		expect(causeLabel(null, 'en')).toBeNull();
		expect(causeLabel(undefined, 'fr')).toBeNull();
		expect(causeLabel('', 'en')).toBeNull();
		// A bare str(int) vendor code carries no meaning.
		expect(causeLabel('7', 'en')).toBeNull();
	});
});

describe('effectLabel', () => {
	it('maps known GTFS-RT effects to bilingual labels', () => {
		expect(effectLabel('DETOUR', 'en')).toBe('Detour');
		expect(effectLabel('DETOUR', 'fr')).toBe('Détour');
		expect(effectLabel('SIGNIFICANT_DELAYS', 'en')).toBe('Significant delays');
		expect(effectLabel('SIGNIFICANT_DELAYS', 'fr')).toBe('Retards importants');
		expect(effectLabel('ACCESSIBILITY_ISSUE', 'fr')).toBe("Problème d'accessibilité");
	});

	it('humanizes an unknown/vendor effect instead of showing it raw', () => {
		expect(effectLabel('SHUTTLE_BUS', 'en')).toBe('Shuttle bus');
		expect(effectLabel('SHUTTLE_BUS', 'fr')).toBe('Shuttle bus');
	});

	it('renders nothing for uninformative or absent effects', () => {
		expect(effectLabel('UNKNOWN_EFFECT', 'en')).toBeNull();
		expect(effectLabel('OTHER_EFFECT', 'fr')).toBeNull();
		expect(effectLabel('NO_EFFECT', 'en')).toBeNull();
		expect(effectLabel(null, 'en')).toBeNull();
		expect(effectLabel(undefined, 'fr')).toBeNull();
	});
});
