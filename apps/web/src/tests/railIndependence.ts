import { act, fireEvent, within } from '@testing-library/svelte';
import { sections } from '@yesid/ui/state';
import { expect } from 'vitest';

interface RailIndependenceOptions {
	container: HTMLElement;
	panelNames: readonly [string, string];
	contentCount: number;
	/** Line and stop surfaces receive page bulk actions from their containing article. */
	bulkAction?: 'toggle' | 'store';
}

/** Exercise the same bulk-action contract against each real surface's own fixtures and mocks. */
export async function assertRailIndependence({
	container,
	panelNames,
	contentCount,
	bulkAction = 'toggle',
}: RailIndependenceOptions): Promise<void> {
	const rail = container.querySelector<HTMLElement>('[data-slot="surface-rail"]');
	expect(rail).not.toBeNull();
	if (rail == null) throw new Error('Expected the real surface rail.');
	const panels = panelNames.map((name) => within(rail).getByRole('button', { name }));
	expect([...rail.querySelectorAll('[data-section-trigger]')]).toEqual(panels);
	const content = [...container.querySelectorAll('[data-section-trigger]')].filter(
		(trigger) => !rail.contains(trigger),
	);
	expect(contentCount).toBeGreaterThan(1);
	expect(content).toHaveLength(contentCount);
	expect(sections.count).toBe(contentCount);
	const toggle = bulkAction === 'toggle' ? within(container).getByTestId('sections-toggle') : null;

	for (const panelStates of [
		[true, true],
		[false, true],
		[true, false],
		[false, false],
	]) {
		for (const [index, panel] of panels.entries()) {
			if (panel.getAttribute('aria-expanded') !== String(panelStates[index])) {
				await fireEvent.click(panel);
			}
		}

		for (const expanded of [false, true]) {
			if (toggle != null) await fireEvent.click(toggle);
			else await act(() => (expanded ? sections.expandAll() : sections.collapseAll()));

			for (const trigger of content) {
				expect(trigger).toHaveAttribute('aria-expanded', String(expanded));
			}
			for (const [index, panel] of panels.entries()) {
				expect(panel).toHaveAttribute('aria-expanded', String(panelStates[index]));
			}
			expect(sections.count).toBe(contentCount);
			expect(sections.allCollapsed).toBe(!expanded);
			if (toggle != null) expect(toggle).toHaveAttribute('data-collapsed', String(!expanded));
		}
	}
}
