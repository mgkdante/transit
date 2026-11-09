import { expect, it } from 'vitest';
import { providerAttribution } from './providerAttribution';

it.each(['stm', 'octranspo'])(
	'localizes %s attribution without changing the published English text',
	(provider) => {
		const published = `Contains ${provider} data`;
		expect(providerAttribution(provider, published, 'en')).toBe(published);
		expect(providerAttribution(provider, published, 'fr')).not.toMatch(/Contains/);
	},
);

it('credits the STM with its full French name and licence', () => {
	expect(providerAttribution('stm', 'Contains STM data', 'fr')).toBe(
		'Contient des données de la Société de transport de Montréal mises à disposition selon la licence CC BY 4.0.',
	);
});

it('uses Ottawa’s official French notice', () => {
	expect(providerAttribution('octranspo', 'Contains OC Transpo data', 'fr')).toBe(
		"Contient de l'information visée par la Licence du gouvernement ouvert – Ville d'Ottawa.",
	);
});

it('preserves attribution for providers without an override', () => {
	expect(providerAttribution('other', 'Provider licence', 'fr')).toBe('Provider licence');
});
