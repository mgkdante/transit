# Data proxy

This Cloudflare Worker serves public snapshots from the `SNAPSHOTS` R2 binding
and a compact network summary at `/api/v1/kpis`. It has no database connection.

`src/worker.js` owns routing and snapshot delivery. `src/cors.js` owns shared
response headers. `src/kpis.js` owns KPI calculation, source freshness, and
caching. Deployment settings live in `wrangler.toml`.

## KPI contract

`GET /api/v1/kpis` returns `snapshotAt`, `freshnessS`, `vehicles`, `avgDelayS`,
`coverage`, `routesLive`, `routesTotal`, and up to five `topRoutes`. Each route
contains `route`, `vehicles`, and `avgDelayS`. `HEAD` returns the same headers
without a body. Breaking field changes require a new endpoint version.

| Source under `v1/stm/`     | Fields and meaning                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `live/vehicles.json`       | Vehicle count, live route count, and routes ranked by vehicle count. Its timestamp anchors `snapshotAt`.                 |
| `live/trips.json`          | Mean finite tracked-trip delay, converted from minutes to seconds and rounded to an integer, globally and per top route. |
| `live/network.json`        | Published `coverage_pct`, converted to a fraction.                                                                       |
| `static/routes_index.json` | Bus route count, excluding métro routes that the live vehicle feed does not track.                                       |

Each live source has its own `generated_utc` timestamp. Every response checks
each timestamp, including memo hits, edge-cache hits, and background refreshes.
A source is unusable at 90 seconds old or more than 90 seconds in the future.
An unusable vehicle anchor returns `503` with `Retry-After: 30`. Unusable trip
or network data nulls only its dependent fields. Missing delay remains null.

Network and route delay means round once to whole seconds, with half ties away
from zero, matching the pipeline's published rounding rule. For example,
−30.5 seconds becomes −31 seconds; negative delays remain meaningful.

## Caching and verification

Requests share one in-flight rebuild per isolate. The memo lasts one 30-second
publication cycle; the Cache API preserves it across isolate recycles. Usable
older entries can serve while refreshing in the background. Failed rebuilds
are throttled for 10 seconds. Static route totals are cached for one hour and
retain their last valid value during a read failure.

Responses use `Cache-Control: no-store` because freshness is evaluated at serve
time. The private edge-cache format is versioned independently from the public
endpoint. `X-Kpis-Cache` reports `miss`, `hit`, or `stale`.

From the repository root, run `bun run --cwd apps/data-proxy check` and
`bun run --cwd apps/data-proxy test`. The tests exercise the Worker with local
R2 and Cache API substitutes. See [Contributing](../../CONTRIBUTING.md) for
the supported toolchain and deployment dry-run checks.

The proxy workflow isolates pull-request and development verification queues
from the main production queue. Production edge updates also share the
`transit-data-edge-production` job lock. Keep these queues separate: disabling
in-progress cancellation does not prevent a new run from replacing pending work.
