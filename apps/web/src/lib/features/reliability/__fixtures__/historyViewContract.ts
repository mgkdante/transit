import { cleanup, waitFor } from '@testing-library/svelte';
import { describe, expect, it, type Mock } from 'vitest';

interface HistoryViewFixture {
	readonly page: { url: URL };
	readonly index: Mock;
	readonly range: Mock;
	readonly entityId?: string;
	readonly mount: () => { container: HTMLElement; destroy?: () => void };
	readonly partitions: unknown;
	readonly grain?: string;
	readonly owned: { read: (container: HTMLElement) => string; current: string; retained: string };
	readonly current?: (container: HTMLElement) => void;
	readonly pending?: (container: HTMLElement) => void;
	readonly loaded?: (container: HTMLElement) => void;
}

/** The same navigation and dataset contract, exercised through each real surface. */
export function historyViewContract(
	entity: 'line' | 'stop' | 'network',
	fixture: HistoryViewFixture,
) {
	function select(query: string): void {
		const next = new URL(fixture.page.url);
		for (const [key, value] of new URLSearchParams(query)) next.searchParams.set(key, value);
		fixture.page.url = next;
	}

	describe(`${entity} reliability history contract`, () => {
		it('discovers history without selecting or loading a retained window', async () => {
			const view = fixture.mount();
			try {
				await waitFor(() => expect(fixture.index).toHaveBeenCalledTimes(1));
				if (fixture.entityId != null)
					expect(fixture.index).toHaveBeenCalledWith(
						fixture.entityId,
						expect.any(Object),
						expect.any(Function),
					);
				expect(fixture.range).not.toHaveBeenCalled();
				expect(fixture.owned.read(view.container)).toContain(fixture.owned.current);
				fixture.current?.(view.container);
			} finally {
				view.destroy?.();
				cleanup();
			}
		});

		it('hides current owned values while pending, then applies the selected retained window', async () => {
			let resolve!: (partitions: unknown) => void;
			fixture.range.mockReturnValueOnce(
				new Promise((done) => {
					resolve = done;
				}),
			);
			select('from=2026-01-31&to=2026-02-01&focus=keep');
			if (fixture.grain) select(`grain=${fixture.grain}`);
			const view = fixture.mount();
			try {
				await waitFor(() => expect(fixture.range).toHaveBeenCalledTimes(1));
				expect(fixture.owned.read(view.container)).not.toContain(fixture.owned.current);
				fixture.pending?.(view.container);
				resolve(fixture.partitions);
				await waitFor(() =>
					expect(fixture.owned.read(view.container)).toContain(fixture.owned.retained),
				);
				fixture.loaded?.(view.container);
				expect(fixture.page.url.searchParams.get('from')).toBe('2026-01-31');
				expect(fixture.page.url.searchParams.get('to')).toBe('2026-02-01');
				expect(fixture.page.url.searchParams.get('focus')).toBe('keep');
			} finally {
				view.destroy?.();
				cleanup();
			}
		});

		it('corrects an invalid window without loading a fallback and preserves unrelated URL state', async () => {
			select('grain=month&from=bad&to=2026-02-01&focus=keep');
			const view = fixture.mount();
			try {
				await waitFor(() => expect(fixture.index).toHaveBeenCalledTimes(1));
				await waitFor(() => expect(fixture.page.url.searchParams.has('from')).toBe(false));
				expect(fixture.page.url.searchParams.has('to')).toBe(false);
				expect(fixture.page.url.searchParams.get('grain')).toBe(entity === 'line' ? null : 'month');
				expect(fixture.page.url.searchParams.get('focus')).toBe('keep');
				expect(fixture.range).not.toHaveBeenCalled();
				const announcements = view.container.querySelectorAll(
					'[data-slot="history-page-announcement"]',
				);
				expect(announcements).toHaveLength(1);
				expect(announcements[0]).toHaveAttribute('role', 'status');
				expect(announcements[0]).toHaveTextContent(/invalid date range.*current snapshot/i);
				for (const navigator of view.container.querySelectorAll(
					'[data-slot="history-announcement"]',
				)) {
					expect(navigator).not.toHaveAttribute('role');
					expect(navigator).not.toHaveAttribute('aria-live');
				}
			} finally {
				view.destroy?.();
				cleanup();
			}
		});
	});
}
