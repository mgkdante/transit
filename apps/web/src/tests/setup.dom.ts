// Vitest "dom" project setup (happy-dom env).
import '@testing-library/jest-dom/vitest';
import { configureTransitUi } from '$lib/ui/configure';

configureTransitUi();
// P3.19 adds the throwing-fetch stub + render helpers.
