import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import RailDisclosureControllerHarness from './__fixtures__/RailDisclosureControllerHarness.svelte';

const controllerPath = resolve(
	process.cwd(),
	'src/lib/components/surface/createRailDisclosureController.svelte.ts',
);
const PRIMARY_STORAGE_KEY = 'transit.persisted:rail-controller-test-primary';
const TOC_STORAGE_KEY = 'transit.persisted:rail-controller-test-toc';
const consumers = [
	{
		file: 'src/lib/features/alerts/AlertHistory.svelte',
		keys: ["filters: 'alerts-filters'", "toc: 'alerts-toc'"],
	},
	{
		file: 'src/lib/features/hotspots/HotspotsBoard.svelte',
		keys: ["controls: 'hotspots-controls'", "toc: 'hotspots-toc'"],
	},
	{
		file: 'src/lib/features/repeat-offenders/RepeatOffenders.svelte',
		keys: ["controls: 'repeat-offenders-controls'", "toc: 'repeat-offenders-toc'"],
	},
	{
		file: 'src/lib/features/receipt/AccountabilityReceipt.svelte',
		keys: ["controls: 'receipt-controls'", "toc: 'receipt-toc'"],
	},
] as const;

beforeEach(() => {
	quietModeStore.resetForTest();
	sessionStorage.removeItem(PRIMARY_STORAGE_KEY);
	sessionStorage.removeItem(TOC_STORAGE_KEY);
});

afterEach(() => {
	cleanup();
	quietModeStore.resetForTest();
	sessionStorage.removeItem(PRIMARY_STORAGE_KEY);
	sessionStorage.removeItem(TOC_STORAGE_KEY);
});

function harness(): HTMLElement {
	return screen.getByTestId('rail-controller-harness');
}

describe('combined rail disclosure controller', () => {
	it('exists as one shared surface primitive', () => {
		expect(existsSync(controllerPath)).toBe(true);
	});

	it('exports the shared controller factory', () => {
		expect(readFileSync(controllerPath, 'utf8')).toContain(
			'export function createRailDisclosureController',
		);
	});

	it('sets and persists each disclosure independently and sets both on demand', async () => {
		const first = render(RailDisclosureControllerHarness);
		expect(harness()).toHaveAttribute('data-primary-open', 'true');
		expect(harness()).toHaveAttribute('data-toc-open', 'true');

		await fireEvent.click(screen.getByTestId('toggle-primary'));
		expect(harness()).toHaveAttribute('data-primary-open', 'false');
		expect(harness()).toHaveAttribute('data-toc-open', 'true');
		expect(sessionStorage.getItem(PRIMARY_STORAGE_KEY)).toBe('false');
		expect(sessionStorage.getItem(TOC_STORAGE_KEY)).toBeNull();

		await fireEvent.click(screen.getByTestId('close-all'));
		expect(harness()).toHaveAttribute('data-primary-open', 'false');
		expect(harness()).toHaveAttribute('data-toc-open', 'false');
		expect(sessionStorage.getItem(TOC_STORAGE_KEY)).toBe('false');
		first.unmount();

		render(RailDisclosureControllerHarness);
		await waitFor(() => expect(harness()).toHaveAttribute('data-primary-open', 'false'));
		expect(harness()).toHaveAttribute('data-toc-open', 'false');

		await fireEvent.click(screen.getByTestId('open-all'));
		expect(harness()).toHaveAttribute('data-primary-open', 'true');
		expect(harness()).toHaveAttribute('data-toc-open', 'true');
	});

	it('preserves page-owned persisted choices across the mount-time open signal', async () => {
		sessionStorage.setItem(PRIMARY_STORAGE_KEY, 'false');
		sessionStorage.setItem(TOC_STORAGE_KEY, 'true');

		render(RailDisclosureControllerHarness);

		await waitFor(() => expect(harness()).toHaveAttribute('data-primary-open', 'false'));
		expect(harness()).toHaveAttribute('data-toc-open', 'true');
	});

	it('lets the remembered collapsed preference win on mount', async () => {
		sessionStorage.setItem(PRIMARY_STORAGE_KEY, 'true');
		sessionStorage.setItem(TOC_STORAGE_KEY, 'true');
		localStorage.setItem('transit:quiet-mode', 'true');

		render(RailDisclosureControllerHarness);

		await waitFor(() => {
			expect(harness()).toHaveAttribute('data-primary-open', 'false');
			expect(harness()).toHaveAttribute('data-toc-open', 'false');
		});
		expect(sessionStorage.getItem(PRIMARY_STORAGE_KEY)).toBe('false');
		expect(sessionStorage.getItem(TOC_STORAGE_KEY)).toBe('false');
	});

	it('mirrors every later quiet-mode close and open signal into both disclosures', async () => {
		render(RailDisclosureControllerHarness);
		await waitFor(() => expect(harness()).toHaveAttribute('data-primary-open', 'true'));

		await fireEvent.click(screen.getByTestId('quiet-toggle'));
		expect(harness()).toHaveAttribute('data-primary-open', 'false');
		expect(harness()).toHaveAttribute('data-toc-open', 'false');

		await fireEvent.click(screen.getByTestId('toggle-primary'));
		expect(harness()).toHaveAttribute('data-primary-open', 'true');
		expect(harness()).toHaveAttribute('data-toc-open', 'false');

		await fireEvent.click(screen.getByTestId('quiet-toggle'));
		expect(harness()).toHaveAttribute('data-primary-open', 'true');
		expect(harness()).toHaveAttribute('data-toc-open', 'true');
	});

	it('is the single rail-disclosure state and signal owner for all four article surfaces', () => {
		for (const consumer of consumers) {
			const source = readFileSync(resolve(process.cwd(), consumer.file), 'utf8');
			expect(source, consumer.file).toContain('createRailDisclosureController');
			for (const key of consumer.keys) expect(source, consumer.file).toContain(key);
			for (const duplicate of [
				'persisted(',
				'railSignalsReady',
				'lastRailCloseSignal',
				'lastRailOpenSignal',
				'setAllRailOpen',
			]) {
				expect(source, consumer.file).not.toContain(duplicate);
			}
		}
	});
});
