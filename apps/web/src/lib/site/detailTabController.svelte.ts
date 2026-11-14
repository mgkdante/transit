import { detailTabFromSearchParams, detailTabQueryValue, type DetailTab } from './detailTabs';
import { mirrorSearchParam } from './urlMirror';

export interface DetailTabController {
	get active(): DetailTab;
	set active(next: DetailTab);
	syncFromUrl(url: URL): void;
}

export function createDetailTabController(initialUrl: URL): DetailTabController {
	let active = $state<DetailTab>(detailTabFromSearchParams(initialUrl.searchParams));

	function syncFromUrl(url: URL): void {
		const next = detailTabFromSearchParams(url.searchParams);
		active = next;

		const canonicalValue = detailTabQueryValue(next);
		const values = url.searchParams.getAll('tab');
		const isCanonical =
			canonicalValue === null
				? values.length === 0
				: values.length === 1 && values[0] === canonicalValue;
		if (!isCanonical) mirrorSearchParam('tab', canonicalValue);
	}

	return {
		get active() {
			return active;
		},
		set active(next: DetailTab) {
			active = next;
			mirrorSearchParam('tab', detailTabQueryValue(next));
		},
		syncFromUrl,
	};
}
