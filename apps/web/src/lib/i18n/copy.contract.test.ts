import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { LocalizedCopy } from './copy';
import * as i18n from './index';
import { cornerMetaLabels } from '../components/brand/cornerMeta.copy';
import { footerCopy } from '../components/layout/footer.copy';
import { navPillCopy } from '../components/shell/navPill.copy';
import { articleNavigationCopy } from '../components/shared/articleNavigation.copy';
import { alertHistoryCopy } from '../features/alerts/alerts.copy';
import { copy as healthCopy } from '../features/health/health.copy';
import { copy as hotspotsCopy } from '../features/hotspots/hotspots.copy';
import { legalCopy } from '../features/legal/legal.copy';
import {
	detailCopy as lineDetailCopy,
	indexCopy as lineIndexCopy,
} from '../features/lines/lines.copy';
import { habitsBandCopy } from '../features/lines/reliability/Cluster05Habits.copy';
import { reliabilityCopy } from '../features/lines/reliability/reliability.copy';
import { copy as mapCopy } from '../features/map/map.copy';
import { MAP_SELECTION_DETAIL_COPY } from '../features/map/mapSelectionDetail.copy';
import { metricsCopy } from '../features/metrics/metrics.copy';
import { networkReliabilityCopy } from '../features/network/reliability/network-reliability.copy';
import { copy as receiptCopy } from '../features/receipt/receipt.copy';
import { copy as repeatOffendersCopy } from '../features/repeat-offenders/repeatOffenders.copy';
import { copy as searchCopy } from '../features/search/search.copy';
import { stopReliabilityCopy } from '../features/stops/reliability/stops-reliability.copy';
import {
	detailCopy as stopDetailCopy,
	indexCopy as stopIndexCopy,
} from '../features/stops/stops.copy';
import { tripCopy } from '../features/trips/trips.copy';

type ExpandedLocaleCopy = LocalizedCopy<{ readonly title: string }, 'fr' | 'en' | 'es'>;

// @ts-expect-error Every configured noncanonical locale must remain required.
const incompleteExpandedLocaleCopy: ExpandedLocaleCopy = {
	fr: { title: 'Titre' },
	en: { title: 'Title' },
};
void incompleteExpandedLocaleCopy;

const COPY_EXPORTS = {
	cornerMetaLabels,
	footerCopy,
	navPillCopy,
	articleNavigationCopy,
	alertHistoryCopy,
	healthCopy,
	hotspotsCopy,
	legalCopy,
	lineIndexCopy,
	lineDetailCopy,
	habitsBandCopy,
	reliabilityCopy,
	mapCopy,
	mapSelectionDetailCopy: MAP_SELECTION_DETAIL_COPY,
	metricsCopy,
	networkReliabilityCopy,
	receiptCopy,
	repeatOffendersCopy,
	searchCopy,
	stopReliabilityCopy,
	stopIndexCopy,
	stopDetailCopy,
	tripCopy,
} as const;

function serialize(value: unknown): string {
	if (typeof value === 'function') {
		return `function(${value.length}):${Function.prototype.toString.call(value)}`;
	}
	if (Array.isArray(value)) return `array:[${value.map(serialize).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `object:{${Object.entries(value)
			.map(([key, item]) => `${JSON.stringify(key)}:${serialize(item)}`)
			.join(',')}}`;
	}
	return `${typeof value}:${JSON.stringify(value)}`;
}

function fingerprint(value: unknown): string {
	return createHash('sha256').update(serialize(value)).digest('hex');
}

describe('bilingual copy contract', () => {
	test('exposes the typed copy factory from the i18n owner', () => {
		expect(i18n).toHaveProperty('defineCopy');
	});

	test('preserves every localized runtime value, function body, and key order', () => {
		expect(
			Object.fromEntries(
				Object.entries(COPY_EXPORTS).map(([key, value]) => [key, fingerprint(value)]),
			),
		).toEqual({
			alertHistoryCopy: '21513a2e71bafe967840f932cf28c64538575cfb3dde2d3e27c5b4521f46bd67',
			articleNavigationCopy: '2ca7f81b16d17ae3b0070c935081e0e36fab59e8798914aaaa5bcf3dd3503df8',
			cornerMetaLabels: '2dc822ad168696db7d9fcb10c5637c64ee36e37c187fdb807f39140a2c112bf9',
			footerCopy: 'e3245cf5d7e6152bf5228ae6e3bf06cc965cc713755b5254fab136eebc642292',
			habitsBandCopy: '498737c12702c22aaa9cdbab83ddba5ef679a6a0f757dcaed59cfb9fc705200c',
			healthCopy: '0b67efc9ccd036dcde33fe88f09800441c42dfa2bfb63976397bf0014c9a774b',
			hotspotsCopy: '2995f1994b9d88b3f5b690f7a4c91158575bdfceb90335ae25773798b1149f43',
			lineDetailCopy: '7cb8c2078f7d8c5fa6cf3ff73a2ad6642c829cdb3fa1a78b5c514342b89eb4b8',
			lineIndexCopy: '50b9f280c49f3aadb8330d27a350de6d8338db2a4671672ea0717fcf2bbb2406',
			legalCopy: '964dbf1b15fbaa01381e11a826ee22bc5d0b51a35398c87c896645a79b9257ae',
			mapCopy: '6349594f40e53c2ded130cf3eee960678abd71de2eb69b98b0b9251560c3d001',
			mapSelectionDetailCopy: 'eb4d19b326fbe3438f616f8e5844488dc390a9a033de9604f296405a134ebf1b',
			metricsCopy: '836857439792b6506b8bb691d286186a816b29b09c0b5525d3f2cd9843f202e4',
			networkReliabilityCopy: '1f17b10e6c9ff75c7ce6de97e87ffb9a48b88da32d53c807a1ad4b3e7c412cef',
			navPillCopy: 'bb284ab62237e0ab81072f8a7ab5777bbdc3b689c4b0295821ae615a8e4f2f64',
			receiptCopy: '065ec4d87da91e9edc4c06cf9ce74fae10670b42519c48deaedf427119f63a85',
			reliabilityCopy: 'fa3cb28ed9fa3a34ca1b996eaa2bb8dd937dcf98c7da0aa79c74dd6db5860c51',
			repeatOffendersCopy: '3668c85d736fa84e9a4c7901a94237f150a61c1928e88d1650fad41b61b29b58',
			searchCopy: '7e19d9b2a700eca59aee081ac744c83063c85706635803176d682b981db54fe7',
			stopDetailCopy: '87dcb8bb661333d85bd89e880d1000e67ae79ecf7f93f1eaac0359a2dd155495',
			stopIndexCopy: '5b925d9d2a1c004c663ea5f4bc06d6d250e724ffbdf5610eb76979af35ef36a6',
			stopReliabilityCopy: '6a322dd022c4a50605f9ad2e5ebb1f3df751bc3e2af69c3752bf8429330c78f3',
			tripCopy: '41eee43fe2a9e1c98364cb7797c958f7077bafdb9d6640b3dab45fe114625ab9',
		});
	});
});
