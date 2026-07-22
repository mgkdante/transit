import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { alertHistoryCopy } from '../features/alerts/alerts.copy';
import { copy as healthCopy } from '../features/health/health.copy';
import { copy as hotspotsCopy } from '../features/hotspots/hotspots.copy';
import { detailCopy as lineDetailCopy } from '../features/lines/lines.copy';
import { reliabilityCopy } from '../features/lines/reliability/reliability.copy';
import { metricsCopy } from '../features/metrics/metrics.copy';
import { networkReliabilityCopy } from '../features/network/reliability/network-reliability.copy';
import { copy as receiptCopy } from '../features/receipt/receipt.copy';
import { copy as repeatOffendersCopy } from '../features/repeat-offenders/repeatOffenders.copy';
import { stopReliabilityCopy } from '../features/stops/reliability/stops-reliability.copy';
import { detailCopy as stopDetailCopy } from '../features/stops/stops.copy';
import * as layout from './layout';
import * as surface from './surface';

function receiptNavigator(locale: 'fr' | 'en') {
	const copy = receiptCopy[locale];
	return {
		group: copy.history.group,
		picker: {
			group: copy.dateSelectLabel,
			start: '',
			end: '',
			clear: '',
			anyStart: '',
			anyEnd: '',
			single: copy.datePicker.label,
		},
		previous: copy.history.previous,
		next: copy.history.next,
	};
}

const FRAGMENTS = {
	article: {
		alertsFr: alertHistoryCopy.fr.article,
		alertsEn: alertHistoryCopy.en.article,
		healthFr: healthCopy.fr.article,
		healthEn: healthCopy.en.article,
		hotspotsFr: hotspotsCopy.fr.article,
		hotspotsEn: hotspotsCopy.en.article,
		lineFr: lineDetailCopy.fr.article,
		lineEn: lineDetailCopy.en.article,
		metricsFr: metricsCopy.fr.article,
		metricsEn: metricsCopy.en.article,
		networkFr: networkReliabilityCopy.fr.article,
		networkEn: networkReliabilityCopy.en.article,
		receiptFr: receiptCopy.fr.article,
		receiptEn: receiptCopy.en.article,
		repeatOffendersFr: repeatOffendersCopy.fr.article,
		repeatOffendersEn: repeatOffendersCopy.en.article,
		stopFr: stopDetailCopy.fr.article,
		stopEn: stopDetailCopy.en.article,
	},
	history: {
		alertsFr: alertHistoryCopy.fr.filters.history.navigator,
		alertsEn: alertHistoryCopy.en.filters.history.navigator,
		hotspotsFr: hotspotsCopy.fr.history.navigator,
		hotspotsEn: hotspotsCopy.en.history.navigator,
		lineFr: reliabilityCopy.fr.history.navigator,
		lineEn: reliabilityCopy.en.history.navigator,
		networkFr: networkReliabilityCopy.fr.history.navigator,
		networkEn: networkReliabilityCopy.en.history.navigator,
		receiptFr: receiptNavigator('fr'),
		receiptEn: receiptNavigator('en'),
		repeatOffendersFr: repeatOffendersCopy.fr.history.navigator,
		repeatOffendersEn: repeatOffendersCopy.en.history.navigator,
		stopFr: stopReliabilityCopy.fr.history.navigator,
		stopEn: stopReliabilityCopy.en.history.navigator,
	},
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

function fingerprints(fragments: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(fragments).map(([key, value]) => [
			key,
			createHash('sha256').update(serialize(value)).digest('hex'),
		]),
	);
}

describe('shared copy fragment characterization', () => {
	test('exports each fragment builder beside its component owner', () => {
		expect(layout).toHaveProperty('articleCopy');
		expect(surface).toHaveProperty('historyCopy');
	});

	test('locks ArticleHeader copy values, functions, shapes, and key order', () => {
		expect(fingerprints(FRAGMENTS.article)).toEqual({
			alertsEn: 'd16ce56892800796b90b4bfaa71d08f3b2e5d469a5ce16123a67dd0dd5667988',
			alertsFr: 'ed8a19e9f451578c0d0934156afa74e2f6df6552e319348e3858e3045982c962',
			healthEn: '6979e4434f1d82202075611285ff72deed526c8d8f25d325dc224e1fad3b93b0',
			healthFr: 'da484c3a2ff31fa85e6b594c824cc6206d169345f41519c8ba1784d3f371ee37',
			hotspotsEn: 'ce32312fa79dd43d7394d0057828bedbbfcad4de44e4e70b78369feec5fd1dc2',
			hotspotsFr: 'd8b790ea3a64d4dd55b9039664e477a217bea463d7c2cb36b1b3d06af62e3a47',
			lineEn: 'a021093edcbc2d3a98867a42aa1d35d88d91a2a108303d09fa5ed601a24d92f0',
			lineFr: '1153a331b2072a16d4b590bd96e0f9e04d917d84355be61befef28bd89cc85c2',
			metricsEn: '97e555e99efeb513c62d3d97472f4071c0cf82ebebf72da736d8072bfc500856',
			metricsFr: '5476360b46b17e8d5a0386f8a723d7cedf21df4be891e69ae1e0defa9886318f',
			networkEn: 'cb6a88307ac2375f1bf58832918b3d7d5b63c3a482a417302dbd386c5ea9a367',
			networkFr: '07f983dd13f29cca9f0740c42531cd83a16b3f2e23586dafa10d7c74fdfda996',
			receiptEn: 'dce77fedefeeadff7d7a3b6fb9f1216529b803dc980df55e15f6240b15cf909b',
			receiptFr: '75cd8552b76c622c5ed1a71577c4ef4f4ea26db021cf297ed21f274de4493458',
			repeatOffendersEn: '872bc838f04875e327dea624f9215c54d0d79cca4a06ca7c3fc05857673ac775',
			repeatOffendersFr: 'b3d9bb8383a6b574e41b5e7791bcc23505facd14fd94ad792e69a2088b78e6dc',
			stopEn: 'caf2c64dbc3f5b24e8af7b8f7a43ddeb4440408519524724337f38e99d5c05e6',
			stopFr: '5bb69f0a8ce288c2a211591bd5af3271b3cd0134f635099779f047a6241e345a',
		});
	});

	test('locks HistoryNavigator copy values, functions, shapes, and key order', () => {
		expect(fingerprints(FRAGMENTS.history)).toEqual({
			alertsEn: 'b06d260de93851f8865d6061d1f2c474a93d75a46b983deaab40f313f2eb60e8',
			alertsFr: 'f090737d084890ceb378df908875221c59de05152405792e061da9798f3ec8f3',
			hotspotsEn: 'f222d012b96832509e8964336614811aaca6e9edc56e1b8cb218f98907086e66',
			hotspotsFr: '3a57d3998de38d6f925c72821e346179349dd0b1374a3b5b1386db49e6fbd976',
			lineEn: '1f052828d1622166f5fa4bc7c5acbbfb050987ba2e3b42df24a0c520e4110e6a',
			lineFr: '6238ee96f5bdf9762200f746035319845b95edb9886ad27f582e1869f096ed26',
			networkEn: 'bc3092953ff1688e88af70b87f9623a2bf5ef7c0fd45c8a2057621dc50131aee',
			networkFr: 'd9f6f2afaa567e7c96a479c94101616197d2b72e3080b881534b0cb16e320ed2',
			receiptEn: '59304269e87187841615b652fabcb90f97ebdc112cf68e8944d0bee1d7ea007f',
			receiptFr: 'b7e3a35b210450e9ef40783d27d04edfd427b740b85f26350edae701483edfc8',
			repeatOffendersEn: '45390322f953e835e55c494e9387cedd4a3913dd06e94c9015de30454ab2a076',
			repeatOffendersFr: 'dd5152ac0b0ff44115a8fe3c94c026bf7f62c816708e3f5080b5fb5dccd66498',
			stopEn: 'aa0228de2cdc717f03694f036d261bd63e6b6dca5b7a39e5c05f147ec2bae310',
			stopFr: '5b17556ee3bd7806aa81bea7b4aea2096a391b8b93a0ef5b4066fabb48d5a2e5',
		});
	});
});
