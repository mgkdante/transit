export type DetailTab = 'reliability' | 'detail' | 'schedule';

/** The `tab` query value of a view; the record (`reliability`) is the bare URL's view and has none. */
export function detailTabQueryValue(tab: DetailTab): string | null {
	return tab === 'reliability' ? null : tab;
}

export function detailTabFromSearchParams(searchParams: URLSearchParams): DetailTab {
	const value = searchParams.get('tab');
	return value === 'detail' || value === 'schedule' ? value : 'reliability';
}

export function canonicalDetailTabLocation(url: URL): string | null {
	const values = url.searchParams.getAll('tab');
	if (
		values.length === 0 ||
		(values.length === 1 && (values[0] === 'detail' || values[0] === 'schedule'))
	) {
		return null;
	}

	const canonical = new URL(url);
	const selected = detailTabQueryValue(detailTabFromSearchParams(canonical.searchParams));
	canonical.searchParams.delete('tab');
	if (selected !== null) canonical.searchParams.set('tab', selected);

	return `${canonical.pathname}${canonical.search}`;
}
