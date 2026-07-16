import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DetailTabControllerHarness from './__fixtures__/DetailTabControllerHarness.svelte';

const navigation = vi.hoisted(() => {
	const page = { url: new URL('http://localhost/lines/161'), state: { source: 'test' } };
	return {
		page,
		replaceState: vi.fn((url: string | URL) => {
			page.url = new URL(url, 'http://localhost');
			window.history.replaceState({}, '', `${page.url.pathname}${page.url.search}${page.url.hash}`);
		}),
	};
});

vi.mock('$app/state', () => ({ page: navigation.page }));
vi.mock('$app/navigation', () => ({ replaceState: navigation.replaceState }));

function setExternalUrl(value: string): URL {
	const url = new URL(value, 'http://localhost');
	navigation.page.url = url;
	window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
	return url;
}

function controller(): HTMLElement {
	return screen.getByTestId('detail-tab-controller');
}

describe('bidirectional detail tab controller', () => {
	beforeEach(() => {
		navigation.replaceState.mockClear();
		setExternalUrl('/lines/161?window=am#service-profile');
	});

	it('accepts external same-route query and back-forward changes without writing stale local state', async () => {
		const view = render(DetailTabControllerHarness, { props: { url: navigation.page.url } });
		expect(controller()).toHaveAttribute('data-active', 'detail');

		const reliabilityUrl = setExternalUrl('/lines/161?window=am&tab=reliability#service-profile');
		await view.rerender({ url: reliabilityUrl });
		await waitFor(() => expect(controller()).toHaveAttribute('data-active', 'reliability'));
		expect(navigation.replaceState).not.toHaveBeenCalled();

		const detailUrl = setExternalUrl('/lines/161?window=am#service-profile');
		await view.rerender({ url: detailUrl });
		await waitFor(() => expect(controller()).toHaveAttribute('data-active', 'detail'));
		expect(navigation.replaceState).not.toHaveBeenCalled();
	});

	it('uses replaceState for local clicks, preserves unrelated params, and omits Detail', async () => {
		render(DetailTabControllerHarness, { props: { url: navigation.page.url } });

		await fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
		expect(controller()).toHaveAttribute('data-active', 'schedule');
		expect(navigation.replaceState).toHaveBeenCalledTimes(1);
		let written = new URL(
			navigation.replaceState.mock.calls.at(-1)?.[0] as string | URL,
			window.location.origin,
		);
		expect(written.searchParams.get('tab')).toBe('schedule');
		expect(written.searchParams.get('window')).toBe('am');
		expect(written.hash).toBe('#service-profile');

		await fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
		expect(controller()).toHaveAttribute('data-active', 'detail');
		expect(navigation.replaceState).toHaveBeenCalledTimes(2);
		written = new URL(
			navigation.replaceState.mock.calls.at(-1)?.[0] as string | URL,
			window.location.origin,
		);
		expect(written.searchParams.has('tab')).toBe(false);
		expect(written.searchParams.get('window')).toBe('am');
		expect(written.hash).toBe('#service-profile');
	});

	it('normalizes a legacy external tab to canonical Detail without dropping other params', async () => {
		const legacyUrl = setExternalUrl('/stop/57191?tab=next&from=2026-01-31&to=2026-02-01&line=51');
		render(DetailTabControllerHarness, { props: { url: legacyUrl } });

		await waitFor(() => expect(navigation.replaceState).toHaveBeenCalledOnce());
		const written = new URL(
			navigation.replaceState.mock.calls[0][0] as string | URL,
			window.location.origin,
		);
		expect(controller()).toHaveAttribute('data-active', 'detail');
		expect(written.searchParams.has('tab')).toBe(false);
		expect(written.searchParams.get('from')).toBe('2026-01-31');
		expect(written.searchParams.get('to')).toBe('2026-02-01');
		expect(written.searchParams.get('line')).toBe('51');
	});
});
