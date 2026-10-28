import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { responsiveLayoutHarness } from './__fixtures__/ResponsiveLayoutHarness.svelte';

vi.mock('@yesid/ui/state', async (importOriginal) => ({
	...(await importOriginal<typeof import('@yesid/ui/state')>()),
	desktop: (await import('./__fixtures__/ResponsiveLayoutHarness.svelte')).responsiveLayoutHarness,
}));

import SurfaceRail from './SurfaceRail.svelte';

const rail = createRawSnippet(() => ({
	render: () =>
		`<div data-testid="rail-body">
			<button type="button" data-testid="rail-filter">Day</button>
			<nav data-slot="section-toc"><a href="#sec-a" data-testid="rail-jump">Section A</a></nav>
		</div>`,
}));

const railWithSeam = createRawSnippet<
	[{ closeSheet: () => void; presentation: 'desktop' | 'mobile' }]
>((getArgs) => ({
	render: () =>
		`<div data-testid="rail-body">
			<button type="button" data-testid="rail-seam-jump">Section A</button>
		</div>`,
	setup: (el) => {
		const btn = el.querySelector('[data-testid="rail-seam-jump"]') as HTMLButtonElement;
		btn.addEventListener('click', () => getArgs().closeSheet());
	},
}));

const baseProps = {
	rail,
	label: 'View',
	summary: 'TODAY',
	openAria: 'Open controls',
	closeAria: 'Close controls',
};

beforeEach(() => responsiveLayoutHarness.setDesktop(false));
afterEach(async () => {
	cleanup();
	await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
	document.body.style.removeProperty('overflow');
});

describe('SurfaceRail — desktop article rail', () => {
	it('renders the rail content in the sticky aside', () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const aside = container.querySelector('[data-slot="surface-rail"]');
		expect(aside?.tagName.toLowerCase()).toBe('aside');
		expect(aside?.querySelector('[data-testid="rail-body"]')).not.toBeNull();
	});

	it('mounts one rail body whose presentation follows the viewport', async () => {
		responsiveLayoutHarness.setDesktop(true);
		let mountCount = 0;
		const received: Array<'desktop' | 'mobile'> = [];
		const contextualRail = createRawSnippet<
			[{ closeSheet: () => void; presentation: 'desktop' | 'mobile' }]
		>((getArgs) => ({
			render: () => {
				mountCount += 1;
				return '<div><button type="button" data-testid="contextual-rail">Read context</button></div>';
			},
			setup: (el) => {
				el.querySelector('[data-testid="contextual-rail"]')?.addEventListener('click', () => {
					received.push(getArgs().presentation);
				});
			},
		}));
		const { container } = render(SurfaceRail, {
			props: { ...baseProps, rail: contextualRail },
		});
		const railBody = container.querySelector('[data-testid="contextual-rail"]') as HTMLElement;

		await fireEvent.click(railBody);
		expect(received).toEqual(['desktop']);
		expect(mountCount).toBe(1);

		responsiveLayoutHarness.setDesktop(false);
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		const dialog = mobile.querySelector('[role="dialog"]') as HTMLElement;

		expect(dialog.querySelector('[data-testid="contextual-rail"]')).toBe(railBody);
		expect(container.querySelectorAll('[data-testid="contextual-rail"]')).toHaveLength(1);
		await fireEvent.click(railBody);
		expect(received).toEqual(['desktop', 'mobile']);
		expect(mountCount).toBe(1);
	});
});

describe('SurfaceRail — mobile pill + merged sheet', () => {
	it('can hide only the mobile presentation while preserving the desktop rail body', () => {
		const { container } = render(SurfaceRail, {
			props: { ...baseProps, mobileVisible: false },
		});

		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		const aside = container.querySelector('[data-slot="surface-rail"]');
		expect(aside).not.toBeNull();
		expect(aside?.querySelector('[data-testid="rail-body"]')).not.toBeNull();
	});

	it('closes an open sheet when its mobile presentation becomes hidden', async () => {
		document.body.style.overflow = 'auto';
		const view = render(SurfaceRail, { props: baseProps });
		const mobile = view.container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector('button[aria-expanded]') as HTMLButtonElement);
		expect(document.body.style.overflow).toBe('hidden');

		await view.rerender({ ...baseProps, mobileVisible: false });

		expect(view.container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		await waitFor(() => expect(document.body.style.overflow).toBe('auto'));
		expect(
			view.container.querySelector('[data-slot="surface-rail"] [data-testid="rail-body"]'),
		).not.toBeNull();
	});

	it('closes the sheet and moves focus into the desktop rail when crossing 1024px', async () => {
		responsiveLayoutHarness.setDesktop(false);
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector(':scope > button') as HTMLButtonElement;

		await fireEvent.click(pill);
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		const mobileFilter = within(sheet).getByTestId('rail-filter');
		mobileFilter.focus();
		expect(mobileFilter).toHaveFocus();

		responsiveLayoutHarness.setDesktop(true);

		await waitFor(() => expect(mobile.querySelector('[role="dialog"]')).toBeNull());
		const desktopRail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(desktopRail).getByTestId('rail-filter')).toHaveFocus();
		responsiveLayoutHarness.setDesktop(false);
	});

	it('labels the pill with the heading + summary, and the sheet is closed by default', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;
		expect(pill.getAttribute('aria-expanded')).toBe('false');
		expect(pill.textContent).toContain('View');
		expect(pill.textContent).toContain('TODAY');
		expect(pill).toHaveAccessibleName('View TODAY · Open controls');
		await waitFor(() => expect(mobile.querySelector('[role="dialog"]')).toBeNull());
	});

	it('opens one sheet by moving the existing rail content into it', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const railBody = container.querySelector('[data-testid="rail-body"]') as HTMLElement;
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;
		await fireEvent.click(pill);
		expect(pill.getAttribute('aria-expanded')).toBe('true');
		expect(pill).toHaveAccessibleName('View TODAY · Close controls');
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		expect(sheet).not.toBeNull();
		expect(sheet).toHaveAttribute('aria-modal', 'true');
		expect(sheet).toHaveAccessibleName('View');
		expect(sheet.querySelector('[data-testid="rail-body"]')).toBe(railBody);
		expect(container.querySelectorAll('[data-testid="rail-body"]')).toHaveLength(1);
		expect(sheet.querySelector('[data-testid="rail-filter"]')).not.toBeNull();
		expect(sheet.querySelector('[data-slot="section-toc"]')).not.toBeNull();
	});

	it('traps focus inside the modal sheet', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button[aria-expanded]') as HTMLButtonElement;

		await fireEvent.click(pill);
		const dialog = mobile.querySelector('[role="dialog"]') as HTMLElement;
		const first = within(dialog).getByTestId('rail-filter');
		const last = within(dialog).getByTestId('rail-jump');

		await waitFor(() => expect(first).toHaveFocus());

		last.focus();
		await fireEvent.keyDown(last, { key: 'Tab' });
		expect(first).toHaveFocus();

		await fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
		expect(last).toHaveFocus();
	});

	it('a ToC jump link closes the sheet; a filter tap leaves it open', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;

		await fireEvent.click(pill);
		await waitFor(() => expect(mobile.querySelector('[data-testid="rail-filter"]')).toHaveFocus());
		await fireEvent.click(mobile.querySelector('[data-testid="rail-filter"]') as HTMLElement);
		expect(mobile.querySelector('[role="dialog"]')).not.toBeNull();
		expect(document.activeElement).toBe(
			mobile.querySelector('[data-testid="rail-filter"]') as HTMLElement,
		);

		await fireEvent.click(mobile.querySelector('[data-testid="rail-jump"]') as HTMLElement);
		await waitFor(() => expect(mobile.querySelector('[role="dialog"]')).toBeNull());
		expect(document.activeElement).toBe(pill);
	});

	it('locks background scrolling until the backdrop dismisses the sheet', async () => {
		document.body.style.overflow = 'auto';
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button[aria-expanded]') as HTMLButtonElement;

		await fireEvent.click(pill);
		expect(document.body.style.overflow).toBe('hidden');

		await waitFor(() => expect(mobile.querySelector('[data-testid="rail-filter"]')).toHaveFocus());
		await fireEvent.pointerDown(
			mobile.querySelector('[data-slot="sheet-overlay"]') as HTMLElement,
			{ clientX: 10, clientY: 10 },
		);
		await waitFor(() => expect(mobile.querySelector('[role="dialog"]')).toBeNull());
		await waitFor(() => expect(document.body.style.overflow).toBe('auto'));
		expect(pill).toHaveFocus();
	});

	it('a component ToC tap dismisses the sheet through the explicit closeSheet seam', async () => {
		const { container } = render(SurfaceRail, { props: { ...baseProps, rail: railWithSeam } });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;

		await fireEvent.click(pill);
		expect(mobile.querySelector('[role="dialog"]')).not.toBeNull();

		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		await fireEvent.click(sheet.querySelector('[data-testid="rail-seam-jump"]') as HTMLElement);
		await waitFor(() => expect(mobile.querySelector('[role="dialog"]')).toBeNull());
		expect(document.activeElement).toBe(pill);
	});

	it('Escape closes the open sheet and refocuses the pill', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;
		await fireEvent.click(pill);
		expect(mobile.querySelector('[role="dialog"]')).not.toBeNull();
		await fireEvent.keyDown(mobile.querySelector('[role="dialog"]')!, { key: 'Escape' });
		await waitFor(() => expect(mobile.querySelector('[role="dialog"]')).toBeNull());
		await waitFor(() => expect(pill).toHaveFocus());
	});
});
