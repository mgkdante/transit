# SourceFactory

`run_source_factory_rebuild` plans and executes a provider-scoped recovery. It
writes a preflight report, inventories Bronze, applies the requested cleanup,
resets selected database tables, captures sources and rebuilds Silver and Gold.
The default is a dry run. Execution requires the confirmations described in the
[database guide](../../../README.md).

Injected static loaders must accept and enforce `expected_checksum_sha256` from
the capture result, including unchanged captures.

`SourceFactoryOperationImpls` accepts the same fourteen callable overrides. Their
keyword and result contracts live in `operations.py` and are checked by
`uv run mypy`. Existing runner and package imports remain supported; class
introspection and new pickle metadata identify `operations` as its owner.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `runner.py` | Recovery order, exact capture receipts and final report |
| `operations.py` | Typed operation overrides and production defaults |
| `catalog.py` | Source order, required feeds, reset tables and retained history |
| `guards.py` | Target, namespace and operator confirmations |
| `r2.py` | Archive inventory, cleanup plan and deletion outcomes |
| `artifacts.py`, `models.py` | Report files, hashes and displayed phase results |
| `validation.py` | Explicit validation evidence collected separately from rebuilding |

The runner binds static Silver loading to the captured checksum, including
unchanged-byte retries. It initializes realtime serving before capture. Each
realtime Silver load must match its requested provider, endpoint and capture. The private
backfill result carries those original receipts directly to live projection;
report dictionaries are only for reporting. Missing optional captures can skip,
but their Silver failures still stop the rebuild. Gold history, selected live
projection and warm rollups run in that order.

Cleanup must return its failure list and artifact inventory. Missing receipt
fields stop execution before database reset; absence does not prove success.

Drain ingestion, builders, replayers, publishers and pruners before reset. The
reset transaction preserves retained daily metrics and their coordination state;
it does not acquire a lock shared by every writer. Archive cleanup and database
reset are separate operations, so a later failure does not undo deleted objects.

A successful build phase records that construction finished. It does not imply
that the separate validation collector ran or that operating recovery succeeded.
Tests exercise the public runner, exact receipt identity, failure order, report
bytes and provider isolation. Native database cases require the disposable
database setup in the database guide.
