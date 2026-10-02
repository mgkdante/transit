import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';
import { detailTabFromSearchParams } from '$lib/site/detailTabs';
import { formatUtc } from '$lib/utils/time';

export const load: PageLoad = async ({ data, url, parent }) => {
	let initialClusters;
	let initialImportFailed = false;
	let preparedArticleTime:
		| { routeId: string; iso: string; locale: Locale; text: string }
		| undefined;
	const explicitRange =
		url.searchParams.has('from') ||
		url.searchParams.has('to') ||
		url.searchParams.get('grain') === 'range';
	const settledSelection = !explicitRange || data.lineHistorySeed?.result != null;
	const grain = url.searchParams.get('grain');
	const settledGrain =
		explicitRange ||
		(grain !== 'week' && grain !== 'month') ||
		data.reliabilitySeed?.data?.periods?.some((period) => period.grain === grain);
	if (
		detailTabFromSearchParams(url.searchParams) === 'reliability' &&
		settledSelection &&
		settledGrain
	) {
		try {
			initialClusters = (
				await import('$lib/features/lines/reliability/RouteReliabilityClusters.svelte')
			).default;
		} catch {
			initialImportFailed = true;
		}
		if (browser && initialClusters) {
			const iso = data.reliabilitySeed?.data?.generated_utc ?? data.routeSeed?.data?.generated_utc;
			if (iso) {
				const { lang } = await parent();
				const locale = lang ?? DEFAULT_LOCALE;
				preparedArticleTime = { routeId: data.seed.id, iso, locale, text: formatUtc(iso, locale) };
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
		}
	}
	return {
		...data,
		initialClusters,
		initialImportFailed,
		...(preparedArticleTime ? { preparedArticleTime } : {}),
	};
};
