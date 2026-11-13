"""Close stale capture attempts inside the caller's transaction."""

from itertools import groupby

from sqlalchemy import Connection, text

from transit_ops.history import datasets, ledger
from transit_ops.history.working_captures import CLOSED_UNFINISHED

_CLOSE = text("""
WITH closed AS (
    UPDATE raw.ingestion_runs AS r
    SET status = 'failed', error_message = :closed_unfinished, completed_at_utc = now()
    WHERE r.provider_id = :provider_id
      AND r.run_kind <> 'silver_load'
      AND r.status IN ('pending', 'running')
      AND r.started_at_utc < now() - make_interval(secs => :older_than_seconds)
      AND r.feed_endpoint_id IN (
          SELECT e.feed_endpoint_id FROM core.feed_endpoints e
          WHERE e.provider_id = :provider_id AND e.endpoint_key = ANY(:endpoint_keys))
    RETURNING r.ingestion_run_id, r.feed_endpoint_id, r.started_at_utc
)
SELECT c.ingestion_run_id, e.endpoint_key, (c.started_at_utc AT TIME ZONE 'UTC')::date AS utc_date
FROM closed c JOIN core.feed_endpoints e ON e.feed_endpoint_id = c.feed_endpoint_id
ORDER BY e.endpoint_key, utc_date, c.ingestion_run_id
""")


def close_unfinished_runs(
    connection: Connection,
    *,
    provider_id: str,
    older_than_seconds: int = 3600,
    actor: str | None = None,
) -> int:
    """Fail unfinished capture runs and audit each affected feed-day atomically."""
    if not provider_id:
        raise ValueError("provider_id must not be empty")
    if type(older_than_seconds) is not int or older_than_seconds < 0:
        raise ValueError("older_than_seconds must be a nonnegative int")
    endpoint_keys = sorted(
        dataset.source.endpoint_key
        for dataset in datasets.HISTORY_DATASETS.values()
        if isinstance(dataset.source, datasets.CaptureSource)
    )
    rows = (
        connection.execute(
            _CLOSE,
            dict(
                provider_id=provider_id,
                older_than_seconds=older_than_seconds,
                closed_unfinished=CLOSED_UNFINISHED,
                endpoint_keys=endpoint_keys,
            ),
        )
        .mappings()
        .all()
    )
    for (endpoint, day), group in groupby(rows, key=lambda r: (r["endpoint_key"], r["utc_date"])):
        ledger.record_event(
            connection,
            kind="close_runs",
            dataset_id="capture." + endpoint,
            provider_id=provider_id,
            revision=0,
            window_key=day.isoformat(),
            reason=CLOSED_UNFINISHED,
            details={
                "ingestion_run_ids": [row["ingestion_run_id"] for row in group],
                "older_than_seconds": older_than_seconds,
            },
            actor=actor,
        )
    return len(rows)
