from dataclasses import replace
from datetime import UTC, date, datetime

import pytest

from transit_ops.history import datasets
from transit_ops.lake.table_export import (
    ExportRefused,
    WindowSpec,
    build_copy_statement,
    order_by,
    validate_timeout,
    window_predicate,
)
from transit_ops.lake.table_schema import TableSchema, UnsupportedColumnType


def test_predicate_for_each_grain():
    predicate, values = window_predicate(
        WindowSpec("gold.fact_vehicle_snapshot", "network", "2026-11-14")
    )
    assert predicate.as_string() == '"captured_at_utc" >= %s AND "captured_at_utc" < %s'
    assert values == (datetime(2026, 11, 14, tzinfo=UTC), datetime(2026, 11, 15, tzinfo=UTC))
    predicate, values = window_predicate(
        WindowSpec("gold.route_delay_spine", "network", "2026-12"),
        TableSchema.from_columns([("provider_local_date", "date", True)], ["provider_local_date"]),
    )
    assert predicate.as_string() == '"provider_local_date" >= %s AND "provider_local_date" < %s'
    assert values == (date(2026, 12, 1), date(2027, 1, 1))
    predicate, values = window_predicate(
        WindowSpec("gold.route_delay_hourly", "network", "2024-02"),
        TableSchema.from_columns(
            [("period_start_utc", "timestamp with time zone", True)], ["period_start_utc"]
        ),
    )
    assert predicate.as_string() == '"period_start_utc" >= %s AND "period_start_utc" < %s'
    assert values == (datetime(2024, 2, 1, tzinfo=UTC), datetime(2024, 3, 1, tzinfo=UTC))
    predicate, values = window_predicate(
        WindowSpec("silver.routes", "_shared", "a" * 64), dataset_version_id=42
    )
    assert predicate.as_string() == '"dataset_version_id" = %s'
    assert values == (42,)
    predicate, values = window_predicate(WindowSpec("gold.report_labels", "_shared", "2026-11"))
    assert predicate.as_string() == ""
    assert values == ()


@pytest.mark.parametrize("has_provider,provider", [(True, "_shared"), (False, "network")])
def test_shared_provider_key_only_for_tables_without_provider_id(has_provider, provider):
    rows = [("label_key", "text", True)]
    if has_provider:
        rows.append(("provider_id", "text", True))
    schema = TableSchema.from_columns(rows, ["label_key"])
    with pytest.raises(ExportRefused) as error:
        build_copy_statement(WindowSpec("gold.report_labels", provider, "2026-11"), schema)
    assert error.value.reason == "window"


@pytest.mark.parametrize("timeout", [0, -1, 901, True, 1.5])
def test_timeout_bounds_are_enforced(timeout):
    with pytest.raises(ExportRefused) as error:
        validate_timeout(timeout)
    assert error.value.reason == "timeout_bounds"


@pytest.mark.parametrize("timeout", [1, 900])
def test_valid_timeout_bounds(timeout):
    assert validate_timeout(timeout) is None


@pytest.mark.parametrize("dataset", ["missing.table", "capture.trip_updates"])
def test_undeclared_dataset_is_refused(dataset):
    with pytest.raises(ExportRefused) as error:
        window_predicate(WindowSpec(dataset, "network", "2026-11-14"))
    assert error.value.reason == "undeclared"


@pytest.mark.parametrize(
    "pg_type",
    ["text", "character varying", "character", "character(3)", "character varying(20)"]
    + ["citext", "name", '"char"', "bpchar", "text[]", "label_domain"],
)
def test_order_by_collates_only_text_key_columns(pg_type):
    schema = TableSchema.from_columns(
        [
            ("text_key", pg_type, True),
            ("number", "integer", True),
            ("day", "date", True),
            ("stamp", "timestamp with time zone", True),
        ],
        ["text_key", "number", "day", "stamp"],
    )
    text_keys = frozenset({"text_key"}) if pg_type == "label_domain" else frozenset()
    ordering = order_by(schema, text_keys=text_keys)
    assert ordering.as_string() == '"text_key" COLLATE "C", "number", "day", "stamp"'


def test_copy_statement_keeps_columns_and_parameters_in_order():
    schema = TableSchema.from_columns(
        [
            ("provider_id", "text", True),
            ("revision", "integer", True),
            ("service_date", "date", True),
            ('unusual"column', "jsonb", False),
        ],
        ["provider_id", "revision", "service_date"],
    )
    statement, values = build_copy_statement(
        WindowSpec("gold.network_vehicle_day", "a' OR true --", "2026-11", 3), schema
    )
    assert statement.as_string() == (
        'COPY (SELECT "provider_id", "revision", "service_date", "unusual""column" '
        'FROM "gold"."network_vehicle_day" WHERE "provider_id" = %s '
        'AND "service_date" >= %s AND "service_date" < %s AND "revision" = %s '
        'ORDER BY "provider_id" COLLATE "C", "revision", "service_date") '
        "TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
    )
    assert values == ("a' OR true --", date(2026, 11, 1), date(2026, 12, 1), 3)


def test_whole_state_summary_never_joins_edition_metadata():
    schema = TableSchema.from_columns(
        [
            ("provider_id", "text", True),
            ("dataset_version_id", "bigint", True),
            ("route_id", "text", True),
            ("day_type", "text", True),
        ],
        ["provider_id", "dataset_version_id", "route_id", "day_type"],
    )
    statement, values = build_copy_statement(
        WindowSpec("gold.schedule_version_service_summary", "network", "2026-11"), schema
    )
    assert statement.as_string() == (
        'COPY (SELECT "provider_id", "dataset_version_id", "route_id", "day_type" '
        'FROM "gold"."schedule_version_service_summary" WHERE "provider_id" = %s '
        'ORDER BY "provider_id" COLLATE "C", "dataset_version_id", "route_id" COLLATE "C", '
        '"day_type" COLLATE "C") TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING \'UTF8\')'
    )
    assert values == ("network",)


def test_shared_whole_table_has_no_where_clause():
    schema = TableSchema.from_columns([("label_key", "text", True)], ["label_key"])
    statement, values = build_copy_statement(
        WindowSpec("gold.report_labels", "_shared", "2026-11"), schema
    )
    assert statement.as_string() == (
        'COPY (SELECT "label_key" FROM "gold"."report_labels" '
        'ORDER BY "label_key" COLLATE "C") '
        "TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
    )
    assert values == ()


def test_edition_statement_binds_resolved_id_and_preserves_postgres_text():
    schema = TableSchema.from_columns(
        [
            ("dataset_version_id", "bigint", True),
            ("provider_id", "text", True),
            ("route_id", "text", True),
            ("amount", "numeric", False),
            ("bins", "smallint[]", False),
            ("metadata", "jsonb", False),
        ],
        ["dataset_version_id", "route_id"],
    )
    statement, values = build_copy_statement(
        WindowSpec("silver.routes", "network", "a" * 64), schema, dataset_version_id=42
    )
    assert statement.as_string() == (
        'COPY (SELECT "dataset_version_id", "provider_id", "route_id", "amount", '
        '"bins", "metadata" '
        'FROM "silver"."routes" WHERE "provider_id" = %s AND "dataset_version_id" = %s '
        'ORDER BY "dataset_version_id", "route_id" COLLATE "C") '
        "TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
    )
    assert values == ("network", 42)


@pytest.mark.parametrize(
    "spec,edition",
    [
        (WindowSpec([], "network", "2026-11"), None),
        (WindowSpec("gold.report_labels", 3, "2026-11"), None),
        (WindowSpec("gold.report_labels", "_shared", None), None),
        (WindowSpec("gold.report_labels", "_shared", "2026-11"), 42),
    ],
)
def test_bad_input_types_have_named_refusals(spec, edition):
    with pytest.raises(ExportRefused):
        window_predicate(spec, dataset_version_id=edition)


@pytest.mark.parametrize("pg_type", ["uuid_domain", "point"])
def test_unknown_key_types_are_refused(pg_type):
    with pytest.raises(UnsupportedColumnType, match="key"):
        order_by(TableSchema.from_columns([("key", pg_type, True)], ["key"]))


def test_unplanned_grain_is_refused(monkeypatch):
    declared = datasets.get_dataset("gold.report_labels")
    monkeypatch.setattr(
        "transit_ops.history.datasets.HISTORY_DATASETS",
        {declared.dataset_id: replace(declared, archive_grain="service_day")},
    )
    with pytest.raises(ExportRefused, match="window"):
        window_predicate(WindowSpec(declared.dataset_id, "_shared", "2026-11-14"))


@pytest.mark.parametrize(
    "dataset,key,options",
    [
        ("gold.route_delay_spine", "2026-11", {}),
        (
            "gold.route_delay_spine",
            "2026-11",
            {
                "schema": TableSchema.from_columns(
                    [("provider_local_date", "integer", True)], ["provider_local_date"]
                )
            },
        ),
        *[("silver.routes", "a" * 64, {"dataset_version_id": value}) for value in [0, -1, True]],
    ],
)
def test_missing_or_invalid_window_metadata_is_refused(dataset, key, options):
    with pytest.raises(ExportRefused, match="window"):
        window_predicate(WindowSpec(dataset, "network", key), **options)


def test_fact_statement_has_the_rescue_shape():
    schema = TableSchema.from_columns(
        [
            ("provider_id", "text", True),
            ("realtime_snapshot_id", "bigint", True),
            ("entity_index", "integer", True),
            ("captured_at_utc", "timestamp with time zone", True),
        ],
        ["provider_id", "realtime_snapshot_id", "entity_index"],
    )
    statement, values = build_copy_statement(
        WindowSpec("gold.fact_vehicle_snapshot", "network", "2026-11-14"), schema
    )
    assert statement.as_string() == (
        'COPY (SELECT "provider_id", "realtime_snapshot_id", "entity_index", "captured_at_utc" '
        'FROM "gold"."fact_vehicle_snapshot" WHERE "provider_id" = %s '
        'AND "captured_at_utc" >= %s AND "captured_at_utc" < %s '
        'ORDER BY "provider_id" COLLATE "C", "realtime_snapshot_id", "entity_index") '
        "TO STDOUT WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')"
    )
    assert values == (
        "network",
        datetime(2026, 11, 14, tzinfo=UTC),
        datetime(2026, 11, 15, tzinfo=UTC),
    )


@pytest.mark.parametrize(
    "dataset,key,revision",
    [
        ("gold.fact_vehicle_snapshot", "2026-02-30", 0),
        ("gold.fact_vehicle_snapshot", "2026-11-14' OR true", 0),
        ("gold.report_labels", "2026-1", 0),
        ("gold.route_delay_spine", "9999-12", 0),
        ("silver.routes", "a" * 63, 0),
        ("silver.routes", "a" * 64, 0),
        ("gold.report_labels", "2026-11", -1),
        ("gold.report_labels", "2026-11", 1),
    ],
)
def test_invalid_windows_are_refused(dataset, key, revision):
    with pytest.raises(ExportRefused) as error:
        window_predicate(WindowSpec(dataset, "network", key, revision))
    assert error.value.reason == "window"
