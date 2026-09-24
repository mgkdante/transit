# Snapshots

Import supported builder entry points from `snapshots.builders` or
`snapshots.builders.historic`. Private helpers and SQL constants belong to their
leaf modules; older private facade imports must move to those owners. Public
builder names and signatures are preserved. Registry checks discover builder
leaves recursively instead of depending on private re-exports.

`publish_snapshot(provider_id, tier=...)` builds the public `/v1` files from PostgreSQL. The web app and edge proxy consume these files without database access. Use `validate_snapshots` to inspect payload findings without uploading.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `builders/` | SQL, metric populations and payload construction |
| `gate.py` | Payload, metric and graph checks |
| `historic_tier.py` | Historic collection, validation and publication within the caller's database lifetime |
| `historic_compatibility.py` | Prepared-stage inputs and their scoped receipt checks |
| `historic_streams.py` | Network/line/stop child traversal and stamped parent composition/gates shared by publication and validation |
| `historic_graph.py` | Seven-family availability, root checks and immutable-reference inventory |
| `historic_receipts.py` | Source/code evidence, retained-scope accounting and database receipts |
| `publication_lane.py` | Shared provider/tier transaction lock for publishing and historic garbage collection |
| `protocols.py`, `storage.py` | Storage capabilities, immutable bytes, conditional activation and disposable hash caches |
| `publish.py` | Public entry points, transaction scope, readiness checks, live/static coordination and publication-state recording |
| `envelope.py` | Tier timestamps and generation labels |
| `uploads.py` | Ordered upload barriers, bounded batches and provider executor lifetime |
| `historic_gc.py` | Reachability inventory and marking for immutable history |

Historic plans are lazy and must be consumed before their connection closes. Child traversal retains summaries and bounded batches, not the full history. Parent composition stamps and checks the same objects used for activation. Stop parent inputs remain lazy: validation consumes them incrementally; publication retains its existing one-time index list until the root gate completes. Its writer must drain submitted work before returning or raising. Validation uses the same traversal without a writer; it collects findings without enforcing publication failure. Standalone collection and validation do not acquire the publication lane or establish repeatable-read isolation.

## Publication guarantees

All tiers acquire a nonblocking provider/tier lane and read one repeatable database snapshot. Competing same-lane publishers fail before building. Other providers and tiers remain independent. The realtime caller records a publication failure and continues its capture cycle.

| Tier | Write behavior with default checks |
| --- | --- |
| Live | Upload child files, then the manifest; quality findings are reported without blocking the cycle |
| Static | Validate collected payloads, then hash-gate writes; a matching dataset and cache fingerprint can skip rebuilding |
| Historic | Check daily history, build and verify immutable children, compose parents, then conditionally activate the seven-family root |

The lane covers cooperating database transactions. It does not fence a remote request that remains in flight after database ownership is lost. Live files are separately mutable, so readers can see mixed generations during an upload. Local files expose complete bytes through atomic replacement or exclusive creation; that is not a power-loss durability guarantee.

Historic publication refuses known dirty daily history before storage reads or builds. For dates represented in the route-delay spine or its day watermarks, it also rejects recorded dirty five-minute inputs or a detectable newer or missing hourly fold. Missing old markers do not certify completeness. Clean-empty day markers retain this check after the final row disappears. New unrepresented dates do not block historical publication merely because a live frame arrived. Forceable quality findings are separate from mandatory source cleanliness, immutable-content integrity and conditional activation. Corrections committed after the represented snapshot keep their invalidation for the next generation. Repair requires complete retained evidence; absent source records do not prove an empty day. See the [database repair guide](../../../README.md).

## Live predictions

Departures use the latest available Silver trip-update capture, ordered by capture
time with the raw capture ID as a tie-breaker. Select that parent before filtering
its stop times: a retained newer empty capture suppresses older predictions.
The view requires a recorded raw capture ID; it does not require a Gold serving
marker or certify completion of a partially restored Silver capture.

ETA uses the reported departure timestamp, falling back to arrival. Trip files
include predictions within the next 60 minutes, so the final listed stop does
not prove a terminal destination or a complete remaining-stop count. Gold owns
the separately materialized trip delay and status; prediction-only trips retain
unknown status when that measurement is absent.

## Identity and recovery

`generated_utc` follows each payload's tier/data clock; it is not a universal source-age or upload-completion timestamp. Live publication uses one build-start stamp. Static stamps follow dataset loading. Historic publication labels use a UTC day, while the availability root derives its timestamp from available child history. The provider/timestamp `publish_generation_id` can therefore repeat across same-day historical corrections. Exact immutable paths and content hashes distinguish the resulting graphs; scoped receipts bind source and code evidence to network, line and stop artifacts.

Moving code requires updating the family and gate code manifests in `historic_receipts.py`. Identical public payloads do not imply identical source-evidence hashes. Optimization caches may be discarded and rebuilt; malformed durable activation or content metadata remains an error.

Remote root activation precedes publication-state recording and database commit. A later database failure leaves the complete activated graph visible while database changes roll back. The publisher reports that failure and does not automatically retry the whole operation. An explicit retry rechecks current source and the current root; dirty source must be repaired first. Receipt-only persistence failures have their own savepoint and reported outcome.

The native tests `test_historic_source_convergence_real_db.py` connect correction, invalidation, verified day repair, reporting refresh and republication, including state-write and deferred-commit failures. `test_publication_lane_real_db.py` checks contention and snapshot reads. These tests require the disposable database setup in the database guide; a skipped native test is not operating proof.
