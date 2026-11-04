vi.mock('$app/env/public', async () => (await import('./publicEnv.ts')).PUBLIC_ENV);
import { vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: {}, waitUntil: () => {} }));
export {};
