import '@testing-library/jest-dom/vitest';
import { configureTransitUi } from '$lib/ui/configure';
import { sharedClock } from '$lib/stores/clock.svelte';
import { dataRefresh } from '$lib/stores/refresh.svelte';
import { configureV1Runtime } from '$lib/v1/runtime';

configureV1Runtime({ clock: sharedClock, refresh: dataRefresh });
configureTransitUi();
