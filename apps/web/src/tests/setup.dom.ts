import { clock } from '@yesid/ui/state';
import '@testing-library/jest-dom/vitest';
import { configureTransitUi } from '$lib/ui/configure';

import { dataRefresh } from '$lib/stores/refresh.svelte';
import { configureV1Runtime } from '$lib/v1/runtime';

configureV1Runtime({ clock, refresh: dataRefresh });
configureTransitUi();
