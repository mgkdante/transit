
from __future__ import annotations

from importlib import import_module
from pkgutil import walk_packages

import pytest
from sqlalchemy.sql.elements import TextClause

from transit_ops.gold import marts, rollups
from transit_ops.snapshots import builders, publish
from transit_ops.snapshots.builders.historic import _spine as spine
from transit_ops.sql_registry import named_query, query_name, registered_names

_MODULES = [rollups, marts, publish] + [
    import_module(module.name)
    for module in walk_packages(builders.__path__, builders.__name__ + ".")
    if not module.ispkg
]


def _module_text_constants(module):  # noqa: ANN001, ANN202
    for attr, value in vars(module).items():
        if isinstance(value, TextClause):
            yield attr, value


def test_all_module_text_constants_have_markers():
    unmarked = []
    seen = set()
    for module in _MODULES:
        for attr, clause in _module_text_constants(module):
            if id(clause) in seen:
                continue
            seen.add(id(clause))
            if query_name(clause) is None:
                unmarked.append(f"{module.__name__}.{attr}")
    assert not unmarked, f"executed SQL constants missing -- q: marker: {unmarked}"


def test_dict_valued_rollup_statements_have_markers():
    for table_name, clause in rollups.DELETE_REPORTING_AGGREGATES.items():
        assert query_name(clause) is not None, f"DELETE_REPORTING_AGGREGATES[{table_name}]"
    for table_name, clause in rollups.REPORTING_AGGREGATE_UPSERTS.items():
        assert query_name(clause) is not None, f"REPORTING_AGGREGATE_UPSERTS[{table_name}]"


def test_spine_factory_outputs_have_distinct_markers():
    spine_clauses = [
        spine._ROUTE_SPINE_BY_SHIFT_SQL,
        spine._ROUTE_SPINE_BY_DAYTYPE_SQL,
        spine._ROUTE_SPINE_WEEKLY_SQL,
        spine._ROUTE_SPINE_MONTHLY_SQL,
        spine._ROUTE_SPINE_DOW_SQL,
        spine._ROUTE_SPINE_CROSSTAB_SQL,
        spine._NETWORK_SPINE_BY_SHIFT_SQL,
        spine._NETWORK_SPINE_BY_DAYTYPE_SQL,
        spine._W_BY_SHIFT,
        spine._W_BY_DAYTYPE,
        spine._W_DOW,
        spine._W_CROSSTAB,
    ]
    names = [query_name(c) for c in spine_clauses]
    assert all(names)
    assert len(set(names)) == len(names), f"spine names collide: {names}"


def test_no_duplicate_names():
    names = registered_names()
    assert "route.spine.crosstab" in names
    assert "route.spine.crosstab_windowed" in names
    with pytest.raises(ValueError, match="duplicate named_query"):
        named_query("route.spine.crosstab", "SELECT 2")
    with pytest.raises(ValueError):
        named_query("nodots", "SELECT 1")
    with pytest.raises(ValueError):
        named_query("Bad.Name", "SELECT 1")


def test_runtime_factory_statements_carry_markers():
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
    from transit_ops import sql_registry

    clause = named_query("test.registry.roundtrip", "SELECT 1")
    try:
        assert query_name(clause) == "test.registry.roundtrip"
    finally:
        sql_registry._REGISTRY.pop("test.registry.roundtrip", None)
    from sqlalchemy import text

    assert query_name(text("SELECT 1")) is None
