import { expect, it, vi } from 'vitest';

const network = vi.hoisted(() => vi.fn());

vi.mock('$lib/v1/adapter', () => ({
	adapter: { live: { network } },
}));

import { getNetwork } from './live';

it('forwards the request-scoped adapter context when loading the network snapshot', async () => {
	const context = { fetch: vi.fn(), cache: new Map() };
	const snapshot = { generated_utc: '2026-07-14T12:00:00Z' };
	network.mockResolvedValue(snapshot);

	await expect(getNetwork(context)).resolves.toBe(snapshot);
	expect(network).toHaveBeenCalledWith(context);
});
