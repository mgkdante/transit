import { expect, it } from 'vitest';
import { forwardRoute } from '../../e2e/layout-helpers';

it('propagates disposal errors while the page is live', async () => {
	const error = new Error('Response has been disposed');
	await expect(
		forwardRoute({ isClosed: () => false }, async () => {
			throw error;
		}),
	).rejects.toBe(error);
});

it('tolerates disposal after explicit page closure', async () => {
	await expect(
		forwardRoute({ isClosed: () => true }, async () => {
			throw new Error('Target page, context or browser has been closed');
		}),
	).resolves.toBeUndefined();
});

it('preserves real fetch failures even when the page is closed', async () => {
	const error = new Error('route.fetch: socket hang up');
	await expect(
		forwardRoute({ isClosed: () => true }, async () => {
			throw error;
		}),
	).rejects.toBe(error);
});

it('completes a successful handler', async () => {
	await expect(forwardRoute({ isClosed: () => false }, async () => {})).resolves.toBeUndefined();
});
