// Barrel for the v1 snapshot-contract schema layer. Import from
// `$lib/v1/schemas` for the Zod schemas, inferred types, closed enums, the
// IsoUtc brand, and the parsePort() adapter-boundary helper.
//
// These Zod schemas are a hand-authored mirror of the on-disk JSON Schemas in
// ./json (copied verbatim from the pipeline's
// db/src/transit_ops/snapshots/schemas). The JSON Schemas are the REAL
// contract; this layer is the typed, parse-at-the-boundary front door for the
// SvelteKit client. Honesty rule: fields the contract allows to be null are
// .nullable() here — we surface "no data" rather than coercing to zero.

// --- adapter-boundary helper -------------------------------------------------
export { parsePort } from './parse';

// --- shared primitives: closed enums, IsoUtc brand, Manifest/Labels aliases --
// (StatusCode/OccupancyCode/SeverityCode/Grain value-types + their *Schema,
//  isoUtc()/IsoUtc, and the re-exported Manifest/Labels types live here.)
export * from './types';

// --- manifest + labels (root pointers / dictionary) --------------------------
export * from './manifest';
export * from './labels';

// --- live tier ---------------------------------------------------------------
export * from './network';
export * from './vehicles';
export * from './trips';
export * from './stop_departures';
export * from './alerts';

// --- static tier -------------------------------------------------------------
export * from './routes_index';
export * from './route';
export * from './stops_index';
export * from './stop';
export * from './basemap';

// --- historic tier -----------------------------------------------------------
export * from './route_reliability';
export * from './stop_reliability';
export * from './receipts';
export * from './receipts_index';
export * from './repeat_offenders';
export * from './hotspots';
export * from './network_trend';
export * from './alert_history';

// --- provenance --------------------------------------------------------------
export * from './provenance';
