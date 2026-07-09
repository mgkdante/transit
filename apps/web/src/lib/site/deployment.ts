// deployment.ts — THE deployment-identity seam (operator law, 2026-07-09):
// provider names are NEVER hardcoded in components, copy modules, or asset
// generators.
//
//   · runtime UI     → reads the client-booted /v1 manifest (short_name / city /
//                      display_name / attribution) — already the rule site-wide;
//   · SSR head copy  → reads PUBLIC_PROVIDER_* env (site/config.ts), falling back
//                      to provider-neutral copy;
//   · BUILD-TIME     → the PWA webmanifest route and scripts/build-og.ts read
//     surfaces         THIS file (they render before any manifest fetch exists).
//
// One deployed instance serves ONE provider. Onboarding another provider means
// changing THIS file (or the per-deploy PUBLIC_* env) — never grepping copy.
// These values mirror the served manifest.json's short_name / city.
export const DEPLOYMENT_IDENTITY = {
	/** manifest.short_name mirror for build-time surfaces (e.g. "STM"). */
	providerShortName: 'STM',
	/** manifest.city mirror (e.g. "Montréal"). */
	providerCity: 'Montréal',
} as const;
