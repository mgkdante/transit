import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import * as i18n from './index';
import { cornerMetaLabels } from '../components/brand/cornerMeta.copy';
import { articleNavigationCopy } from '../components/shared/articleNavigation.copy';
import { alertHistoryCopy } from '../features/alerts/alerts.copy';
import { copy as healthCopy } from '../features/health/health.copy';
import { copy as hotspotsCopy } from '../features/hotspots/hotspots.copy';
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

const COPY_EXPORTS = {
	cornerMetaLabels,
	articleNavigationCopy,
	alertHistoryCopy,
	healthCopy,
	hotspotsCopy,
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
			alertHistoryCopy: '9ce3d65aa3866cc1cf4aea1fd37bf31b97bbcbf46afb21b911d2311158cde5ec',
			articleNavigationCopy: '2ca7f81b16d17ae3b0070c935081e0e36fab59e8798914aaaa5bcf3dd3503df8',
			cornerMetaLabels: '2dc822ad168696db7d9fcb10c5637c64ee36e37c187fdb807f39140a2c112bf9',
			habitsBandCopy: '498737c12702c22aaa9cdbab83ddba5ef679a6a0f757dcaed59cfb9fc705200c',
			healthCopy: '0b67efc9ccd036dcde33fe88f09800441c42dfa2bfb63976397bf0014c9a774b',
			hotspotsCopy: '2995f1994b9d88b3f5b690f7a4c91158575bdfceb90335ae25773798b1149f43',
			lineDetailCopy: '170459e5870ca0669daef05069156989c99309d28be4322caf15c0af9df1921b',
			lineIndexCopy: '50b9f280c49f3aadb8330d27a350de6d8338db2a4671672ea0717fcf2bbb2406',
			mapCopy: '9e35811b55d876901faa49c18044b0c40c72426c15c787afabc9525b96c0f617',
			mapSelectionDetailCopy: 'f5f2a55e5a342bda461b667801ed2863bd69e26362b9c0a859ee1f5dfcb590cc',
			metricsCopy: '836857439792b6506b8bb691d286186a816b29b09c0b5525d3f2cd9843f202e4',
			networkReliabilityCopy: '1f17b10e6c9ff75c7ce6de97e87ffb9a48b88da32d53c807a1ad4b3e7c412cef',
			receiptCopy: '065ec4d87da91e9edc4c06cf9ce74fae10670b42519c48deaedf427119f63a85',
			reliabilityCopy: 'fa3cb28ed9fa3a34ca1b996eaa2bb8dd937dcf98c7da0aa79c74dd6db5860c51',
			repeatOffendersCopy: '3668c85d736fa84e9a4c7901a94237f150a61c1928e88d1650fad41b61b29b58',
			searchCopy: '7e19d9b2a700eca59aee081ac744c83063c85706635803176d682b981db54fe7',
			stopDetailCopy: 'c6203db44a82d5ea2391c737cf99831bf7c7c45759de0856e85a4f8a73b3e036',
			stopIndexCopy: '5b925d9d2a1c004c663ea5f4bc06d6d250e724ffbdf5610eb76979af35ef36a6',
			stopReliabilityCopy: '6a322dd022c4a50605f9ad2e5ebb1f3df751bc3e2af69c3752bf8429330c78f3',
			tripCopy: '41eee43fe2a9e1c98364cb7797c958f7077bafdb9d6640b3dab45fe114625ab9',
		});
	});
});
