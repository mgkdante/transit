"""Registry coverage: every executed builder/rollup/mart SQL carries a `-- q:` marker.

The named-query registry (transit_ops.sql_registry) stamps each executed SQL constant
with a `-- q:<name>` identity. These tests assert 100% marker coverage across the
module-level TextClause constants and the factory-produced statements, that names are
unique (the import-time guard already enforces this), and the round-trip helper works.
"""

from __future__ import annotations

import pytest
from sqlalchemy.sql.elements import TextClause

from transit_ops.gold import marts, rollups
from transit_ops.snapshots import builders, publish
from transit_ops.snapshots.builders import _helpers, historic, live, static
from transit_ops.sql_registry import named_query, query_name, registered_names

_MODULES = [historic, live, static, _helpers, rollups, marts, publish]

# Fragment constants that are `.format()`-substituted into a parent statement and are
# NEVER executed directly — they must not carry a marker (it would inject a comment
# mid-expression). Excluded from the coverage walk.
_FRAGMENT_NAMES = {
    "_ROUTE_SPINE_PROJECT_TEMPLATE",  # plain str, not a TextClause
}


def _module_text_constants(module):  # noqa: ANN001, ANN202
    for attr in dir(module):
        if attr in _FRAGMENT_NAMES:
            continue
        value = getattr(module, attr)
        if isinstance(value, TextClause):
            yield attr, value


def test_all_module_text_constants_have_markers():
    unmarked = []
    for module in _MODULES:
        for attr, clause in _module_text_constants(module):
            if query_name(clause) is None:
                unmarked.append(f"{module.__name__}.{attr}")
    assert not unmarked, f"executed SQL constants missing -- q: marker: {unmarked}"


def test_dict_valued_rollup_statements_have_markers():
    # The reporting-aggregate DELETE map holds inline-built TextClauses.
    for table_name, clause in rollups.DELETE_REPORTING_AGGREGATES.items():
        assert query_name(clause) is not None, f"DELETE_REPORTING_AGGREGATES[{table_name}]"
    # REPORTING_AGGREGATE_UPSERTS re-uses named UPSERT constants.
    for table_name, clause in rollups.REPORTING_AGGREGATE_UPSERTS.items():
        assert query_name(clause) is not None, f"REPORTING_AGGREGATE_UPSERTS[{table_name}]"


def test_spine_factory_outputs_have_distinct_markers():
    # The 6 whole-history + 4 windowed spine projectors + 2 network projectors must
    # each carry a DISTINCT name (the windowed twins share SQL body otherwise).
    spine_clauses = [
        historic._ROUTE_SPINE_BY_SHIFT_SQL,
        historic._ROUTE_SPINE_BY_DAYTYPE_SQL,
        historic._ROUTE_SPINE_WEEKLY_SQL,
        historic._ROUTE_SPINE_MONTHLY_SQL,
        historic._ROUTE_SPINE_DOW_SQL,
        historic._ROUTE_SPINE_CROSSTAB_SQL,
        historic._NETWORK_SPINE_BY_SHIFT_SQL,
        historic._NETWORK_SPINE_BY_DAYTYPE_SQL,
        historic._W_BY_SHIFT,
        historic._W_BY_DAYTYPE,
        historic._W_DOW,
        historic._W_CROSSTAB,
    ]
    names = [query_name(c) for c in spine_clauses]
    assert all(names)
    assert len(set(names)) == len(names), f"spine names collide: {names}"


def test_no_duplicate_names():
    names = registered_names()
    assert "route.spine.crosstab" in names
    assert "route.spine.crosstab_windowed" in names
    # A name bound to a DIFFERENT body raises; identical re-registration is idempotent.
    with pytest.raises(ValueError, match="duplicate named_query"):
        named_query("route.spine.crosstab", "SELECT 2")
    # Malformed names are rejected: no namespace dot / uppercase.
    with pytest.raises(ValueError):
        named_query("nodots", "SELECT 1")
    with pytest.raises(ValueError):
        named_query("Bad.Name", "SELECT 1")


def test_builders_package_reexports_are_marked():
    # The package __init__ re-exports a handful of constants tests import directly.
    for attr in ("_TREND_DAILY_SQL", "_ROUTE_REL_DAILY_SQL", "_STOP_NAMES_SQL"):
        clause = getattr(builders, attr)
        assert query_name(clause) is not None, attr


def test_runtime_factory_statements_carry_markers():
    # Factory-built executed statements (not module constants) must also be named.
    for table in ("fact_vehicle_snapshot", "latest_vehicle_snapshot"):
        for upsert in (True, False):
            stmt = marts._vehicle_snapshot_statement(
                target_table=table, latest_only=upsert, upsert=upsert
            )
            assert query_name(stmt) is not None, (table, upsert)
    for table in ("fact_trip_delay_snapshot", "latest_trip_delay_snapshot"):
        stmt = marts._trip_delay_snapshot_statement(
            target_table=table, latest_only=False, upsert=False
        )
        assert query_name(stmt) is not None, table
    for kind in rollups.REBUILDABLE_KINDS.values():
        for dry_run in (True, False):
            stmt = rollups._rebuild_row_delete_sql(kind, dry_run=dry_run)
            assert query_name(stmt) is not None, (kind.table, dry_run)


def test_query_name_roundtrip():
    # Test-scoped name, removed afterwards so the process-global registry keeps
    # exactly the import-time set for every later consumer.
    from transit_ops import sql_registry

    clause = named_query("test.registry.roundtrip", "SELECT 1")
    try:
        assert query_name(clause) == "test.registry.roundtrip"
    finally:
        sql_registry._REGISTRY.pop("test.registry.roundtrip", None)
    # A raw statement with no marker returns None.
    from sqlalchemy import text

    assert query_name(text("SELECT 1")) is None
