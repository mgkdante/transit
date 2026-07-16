export const DETAIL_TABS = ['detail', 'schedule', 'reliability'] as const;

export type DetailTab = (typeof DETAIL_TABS)[number];

export function detailTabFromSearchParams(searchParams: URLSearchParams): DetailTab {
	const value = searchParams.get('tab');
	return value === 'schedule' || value === 'reliability' ? value : 'detail';
}

/**
 * Return a relative redirect target when the detail-tab query is not canonical.
 * The default Detail view has no `tab` parameter; Schedule and Reliability keep
 * one explicit value. Every unrelated query parameter stays untouched.
 */
export function canonicalDetailTabLocation(url: URL): string | null {
	const values = url.searchParams.getAll('tab');
	if (
		values.length === 0 ||
		(values.length === 1 && (values[0] === 'schedule' || values[0] === 'reliability'))
	) {
		return null;
	}

	const canonical = new URL(url);
	const selected = detailTabFromSearchParams(canonical.searchParams);
	canonical.searchParams.delete('tab');
	if (selected !== 'detail') canonical.searchParams.set('tab', selected);

	return `${canonical.pathname}${canonical.search}`;
}
