vi.mock('$app/env/public', async () => (await import('./publicEnv.ts')).PUBLIC_ENV);
import { vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: {}, waitUntil: () => {} }));
import { clock } from '@yesid/ui/state';
import '@testing-library/jest-dom/vitest';
import { configureTransitUi } from '#lib/ui/configure.ts';

import { dataRefresh } from '#lib/stores/refresh.svelte.ts';
import { configureV1Runtime } from '#lib/v1/runtime.ts';

configureV1Runtime({ clock, refresh: dataRefresh });
configureTransitUi();
