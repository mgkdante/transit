export type DetailTab = 'detail' | 'schedule' | 'reliability';

export function detailTabFromSearchParams(searchParams: URLSearchParams): DetailTab {
	const value = searchParams.get('tab');
	return value === 'schedule' || value === 'reliability' ? value : 'detail';
}

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
