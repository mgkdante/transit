import { runMobileGeometryHarness } from './mobile-geometry-runner';

runMobileGeometryHarness().catch((error: unknown) => {
	console.error('[mobile-geometry] FAIL');
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
