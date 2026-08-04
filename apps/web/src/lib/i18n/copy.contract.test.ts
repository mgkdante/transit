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
			habitsBandCopy: 'f5216b378b7d0c5283b752cc71595c42624351d83416be0e26d6b79a5c831a2a',
			healthCopy: '59955157e42c2cf19d5662b3e61ffd2ec96ef76a2e22caa98e90ab97f6cd813f',
			hotspotsCopy: '2995f1994b9d88b3f5b690f7a4c91158575bdfceb90335ae25773798b1149f43',
			lineDetailCopy: '12790a92f07d2d505ac30229be29f2b69922c8e0a230c043a11dbfd8c4e6b4a6',
			lineIndexCopy: '50b9f280c49f3aadb8330d27a350de6d8338db2a4671672ea0717fcf2bbb2406',
			legalCopy: '964dbf1b15fbaa01381e11a826ee22bc5d0b51a35398c87c896645a79b9257ae',
			// M6f-2 F14: + feedNotRespondingShort (en/fr), the freshness chip's own
			// short form of the banner's "not responding" verdict.
			mapCopy: '0c95cd1ad763cb56bb61677405f8aa28105b5863f175ee0efa60b22876a16f8d',
			mapSelectionDetailCopy: '8c4872a4fa67d956cd22ac874fa7be4a0e5184de2edd6265d95a8edec2958459',
			metricsCopy: '836857439792b6506b8bb691d286186a816b29b09c0b5525d3f2cd9843f202e4',
			networkReliabilityCopy: 'a80d5f3a3badfae173ea4950b1e98340f6c6fc11eb8c0e6ce6e322973eec9089',
			navPillCopy: 'd713eac79193cb86bdb88048b649fc62de2bfd3a0db8fbe0d3a4bb438afc9f8c',
			receiptCopy: 'bb63dabeeda994033dfad9fb9aa7297001cd04f5ac009593d7cd2243277692d0',
			reliabilityCopy: 'beb50045b79c7ef0b543a999825aaeee0bed152e697ea99d72efd56a389ebc33',
			repeatOffendersCopy: '3668c85d736fa84e9a4c7901a94237f150a61c1928e88d1650fad41b61b29b58',
			searchCopy: 'c5296fc173e02f6a223385ab0f0a2b7e74e7b4a0e55010e82f96c05065e7bbd3',
			stopDetailCopy: '991282c0987f4ac27d944c24015ad3bd3ac7f550602832e018b81d1c4b7ff752',
			stopIndexCopy: '5b925d9d2a1c004c663ea5f4bc06d6d250e724ffbdf5610eb76979af35ef36a6',
			stopReliabilityCopy: 'f4d597881faa1b0d87e844dc0fb804dbebcc20e383d97cc09a46ed3935113c0b',
			tripCopy: '465dbd32208fa2c3da9cf234138a71418772668dadccb18828fcdcd1e6b6d83f',
		});
	});
});
