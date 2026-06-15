"""Static silver/dataset retention tier (slice-9.1.1-zeta split)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from ._helpers import _safe_rowcount, _safe_scalar_count, logger

STATIC_SILVER_TABLES = (
    "silver.stop_times",
    "silver.translations",
    "silver.shapes",
    "silver.route_patterns",
    "silver.directions",
    "silver.calendar_dates",
    "silver.calendar",
    "silver.trips",
    "silver.stops",
    "silver.routes",
    "silver.feed_info",
    "silver.agency",
    "silver.gtfs_extra_rows",
    "silver.gtfs_source_members",
)

STATIC_DATASET_REFERENCE_TABLES = (
    "silver.gis_gtfs_matches",
)

# Every gold table holding an FK to core.dataset_versions
# (fk_gold_dim_*_dataset_version_id, migrations 0004:33/67/104 + 0011:35).
# A static dataset version still referenced by any of these must NOT be deleted
# by the prune (it would FK-violate); it is deferred until gold dims re-point to
# the current version. Extend this tuple if a future migration adds a gold table
# with an FK to core.dataset_versions.
GOLD_DATASET_REFERENCE_TABLES = (
    "gold.dim_route",
    "gold.dim_stop",
    "gold.dim_date",
    "gold.dim_route_pattern",
)

GIS_SILVER_TABLES = (
    "silver.gis_gtfs_matches",
    "silver.gis_line_features",
    "silver.gis_stop_features",
    "silver.gis_datasets",
)

SELECT_STATIC_DATASET_VERSION_IDS = text(
    """
    SELECT dataset_version_id
    FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_kind = 'static_schedule'
    ORDER BY is_current DESC, loaded_at_utc DESC, dataset_version_id DESC
    """
)

# Dataset versions still referenced by any gold dim FK-holder
# (GOLD_DATASET_REFERENCE_TABLES). Deferred from pruning so the DELETE on
# core.dataset_versions can never FK-violate. UNION (not UNION ALL) is fine —
# we only need the distinct set of referenced ids.
SELECT_GOLD_REFERENCED_DATASET_VERSION_IDS = text(
    """
    SELECT DISTINCT dataset_version_id FROM gold.dim_route WHERE provider_id = :provider_id
    UNION
    SELECT DISTINCT dataset_version_id FROM gold.dim_stop WHERE provider_id = :provider_id
    UNION
    SELECT DISTINCT dataset_version_id FROM gold.dim_date WHERE provider_id = :provider_id
    UNION
    SELECT DISTINCT dataset_version_id FROM gold.dim_route_pattern WHERE provider_id = :provider_id
    """
)

DELETE_DATASET_VERSIONS = text(
    """
    DELETE FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)

COUNT_DATASET_VERSIONS = text(
    """
    SELECT COUNT(*) FROM core.dataset_versions
    WHERE provider_id = :provider_id
      AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
    """
)


def _dataset_table_statement(table_name: str, *, dry_run: bool) -> object:
    operation = "SELECT COUNT(*) FROM" if dry_run else "DELETE FROM"
    return text(
        f"""
        {operation} {table_name}
        WHERE provider_id = :provider_id
          AND dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
        """
    )


def _static_dataset_reference_statement(table_name: str, *, dry_run: bool) -> object:
    operation = "SELECT COUNT(*) FROM" if dry_run else "DELETE FROM"
    return text(
        f"""
        {operation} {table_name}
        WHERE provider_id = :provider_id
          AND static_dataset_version_id = ANY(CAST(:dataset_version_ids AS bigint[]))
        """
    )


def _zero_static_prune_counts() -> dict[str, int]:
    return {
        **{table_name: 0 for table_name in STATIC_SILVER_TABLES},
        **{table_name: 0 for table_name in STATIC_DATASET_REFERENCE_TABLES},
        "core.dataset_versions": 0,
    }


def prune_static_silver_datasets(
    connection: Connection,
    *,
    provider_id: str,
    retention_count: int,
    dry_run: bool = False,
) -> tuple[list[int], list[int], list[int], dict[str, int]]:
    """Prune superseded static silver datasets, deferring gold-referenced ones.

    Returns (retained, pruned, deferred, deleted_row_counts). A candidate
    version still referenced by any gold dim FK-holder
    (GOLD_DATASET_REFERENCE_TABLES) is DEFERRED — it keeps BOTH its silver rows
    and its core.dataset_versions row (whole-version retention keeps the
    silver/dim joins consistent) — instead of being deleted, which would
    FK-violate. The next worker cycle prunes it once gold dims re-point to the
    current version (slice-9.1.1j).
    """
    if retention_count <= 0:
        retention_count = 1

    dataset_version_rows = connection.execute(
        SELECT_STATIC_DATASET_VERSION_IDS,
        {"provider_id": provider_id},
    )
    dataset_version_ids = [int(row[0]) for row in dataset_version_rows]
    retained_dataset_version_ids = dataset_version_ids[:retention_count]
    candidate_dataset_version_ids = dataset_version_ids[retention_count:]
    if not candidate_dataset_version_ids:
        # No candidates → skip the gold-reference lookup entirely (zero added
        # steady-state cost at the ~57s worker cadence).
        return retained_dataset_version_ids, [], [], _zero_static_prune_counts()

    gold_referenced_ids = {
        int(row[0])
        for row in connection.execute(
            SELECT_GOLD_REFERENCED_DATASET_VERSION_IDS,
            {"provider_id": provider_id},
        )
    }
    deferred_dataset_version_ids = [
        version_id
        for version_id in candidate_dataset_version_ids
        if version_id in gold_referenced_ids
    ]
    pruned_dataset_version_ids = [
        version_id
        for version_id in candidate_dataset_version_ids
        if version_id not in gold_referenced_ids
    ]
    if deferred_dataset_version_ids:
        logger.warning(
            "Deferring prune of static dataset versions %s for provider '%s' — "
            "still referenced by gold dims; will prune once dims re-point.",
            deferred_dataset_version_ids,
            provider_id,
        )
    if not pruned_dataset_version_ids:
        # Everything is deferred — execute no DELETEs/COUNTs.
        return (
            retained_dataset_version_ids,
            [],
            deferred_dataset_version_ids,
            _zero_static_prune_counts(),
        )

    params = {
        "provider_id": provider_id,
        "dataset_version_ids": pruned_dataset_version_ids,
    }

    counter = _safe_scalar_count if dry_run else _safe_rowcount
    deleted_row_counts = {
        table_name: counter(
            connection.execute(_dataset_table_statement(table_name, dry_run=dry_run), params)
        )
        for table_name in STATIC_SILVER_TABLES
    }
    deleted_row_counts.update(
        {
            table_name: counter(
                connection.execute(
                    _static_dataset_reference_statement(table_name, dry_run=dry_run),
                    params,
                )
            )
            for table_name in STATIC_DATASET_REFERENCE_TABLES
        }
    )
    deleted_row_counts["core.dataset_versions"] = counter(
        connection.execute(
            COUNT_DATASET_VERSIONS if dry_run else DELETE_DATASET_VERSIONS,
            params,
        )
    )
    return (
        retained_dataset_version_ids,
        pruned_dataset_version_ids,
        deferred_dataset_version_ids,
        deleted_row_counts,
    )
