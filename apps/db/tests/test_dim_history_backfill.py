
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from typer.testing import CliRunner

from transit_ops import cli
from transit_ops.gold.dim_history import (
    GTFS_DROP_RUNBOOK,
    INSERT_MISSING_DIM_ROUTE_HISTORY,
    INSERT_MISSING_DIM_STOP_HISTORY,
    DimHistoryBackfillResult,
    _backfill_on_connection,
    parse_gtfs_name_rows,
)

ROUTES_TXT = (
    "route_id,route_short_name,route_long_name,route_type,route_color\n"
    "R_GONE,51,Ancienne ligne,3,00A650\n"
    "R1,9,Ligne Neuf,3,FFD400\n"
    "R1,9,Ligne Neuf bis,3,FFD400\n"
)
STOPS_TXT = (
    "stop_id,stop_name,stop_lat,stop_lon\n"
    "S_GONE,Ancien arret,45.50,-73.60\n"
    "S1,Station Un,45.51,-73.61\n"
    ",Sans id,45.52,-73.62\n"
)
FEED_INFO_TXT = (
    "feed_publisher_name,feed_start_date,feed_end_date\n"
    "STM,20251102,20260322\n"
)


def _write_zip(path: Path, *, with_feed_info: bool = True, members: dict | None = None) -> Path:
    if members is None:
        members = {"routes.txt": ROUTES_TXT, "stops.txt": STOPS_TXT}
        if with_feed_info:
            members["feed_info.txt"] = FEED_INFO_TXT
    with zipfile.ZipFile(path, "w") as zf:
        for name, content in members.items():
            zf.writestr(name, content)
    return path


def test_parse_gtfs_name_rows(tmp_path) -> None:
    zip_path = _write_zip(tmp_path / "gtfs.zip")

    parsed = parse_gtfs_name_rows(zip_path)

    by_route = {r["route_id"]: r for r in parsed.route_rows}
    assert set(by_route) == {"R_GONE", "R1"}
    assert by_route["R_GONE"]["route_long_name"] == "Ancienne ligne"
    assert by_route["R_GONE"]["route_type"] == 3
    assert by_route["R1"]["route_long_name"] == "Ligne Neuf bis"

    by_stop = {s["stop_id"]: s for s in parsed.stop_rows}
    assert set(by_stop) == {"S_GONE", "S1"}
    assert by_stop["S_GONE"]["stop_name"] == "Ancien arret"
    assert by_stop["S_GONE"]["stop_lat"] == 45.50

    assert parsed.feed_start_date is not None
    assert parsed.feed_start_date.isoformat() == "2025-11-02"


def test_parse_gtfs_name_rows_without_feed_info(tmp_path) -> None:
    zip_path = _write_zip(tmp_path / "gtfs.zip", with_feed_info=False)
    parsed = parse_gtfs_name_rows(zip_path)
    assert parsed.feed_start_date is None
    assert parsed.route_rows and parsed.stop_rows


def test_parse_gtfs_name_rows_missing_member_raises(tmp_path) -> None:
    zip_path = _write_zip(tmp_path / "bad.zip", members={"routes.txt": ROUTES_TXT})
    with pytest.raises(ValueError, match="stops.txt"):
        parse_gtfs_name_rows(zip_path)


def test_backfill_statements_are_missing_id_guarded_and_append_only() -> None:
    for sql in (str(INSERT_MISSING_DIM_ROUTE_HISTORY), str(INSERT_MISSING_DIM_STOP_HISTORY)):
        assert "WHERE NOT EXISTS" in sql
        assert "UPDATE" not in sql
        assert "DELETE" not in sql
    assert "gold.dim_route_history" in str(INSERT_MISSING_DIM_ROUTE_HISTORY)
    assert "gold.dim_stop_history" in str(INSERT_MISSING_DIM_STOP_HISTORY)


class _CountResult:
    def __init__(self, value: int) -> None:
        self._value = value

    def scalar_one(self) -> int:
        return self._value


class FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql = str(statement)
        self.calls.append((sql, params))
        if "SELECT count(*)" in sql and "gold.dim_route_history" in sql:
            return _CountResult(1)
        if "SELECT count(*)" in sql and "gold.dim_stop_history" in sql:
            return _CountResult(1)
        return _CountResult(0)


def test_backfill_on_connection_inserts_closed_rows_only(tmp_path) -> None:
    parsed = parse_gtfs_name_rows(_write_zip(tmp_path / "gtfs.zip"))
    conn = FakeConn()

    counts = _backfill_on_connection(conn, provider_id="stm", parsed=parsed)

    assert counts == {
        "routes_in_zip": 2,
        "stops_in_zip": 2,
        "dim_route_history_inserted": 1,
        "dim_stop_history_inserted": 1,
    }

    route_insert = next(
        params for sql, params in conn.calls if "INSERT INTO gold.dim_route_history" in sql
    )
    assert isinstance(route_insert, list) and len(route_insert) == 2
    assert all(p["provider_id"] == "stm" for p in route_insert)
    assert all(p["valid_to_utc"] is not None for p in route_insert)
    assert all(p["valid_from_utc"].date().isoformat() == "2025-11-02" for p in route_insert)

    assert not any("UPDATE" in sql for sql, _ in conn.calls)
    assert not any("DELETE" in sql for sql, _ in conn.calls)


def test_gtfs_drop_runbook_carries_the_invariants() -> None:
    rb = GTFS_DROP_RUNBOOK
    assert "backfill-dim-history" in rb
    assert "--from-gtfs-zip" in rb
    assert "build-gold-marts" in rb
    assert "14 days" in rb
    assert "valid_to_utc IS NOT NULL" in rb
    assert "daily-static-pipeline" in rb
    assert "delay_seconds" in rb
    assert "valid_to_utc IS NULL" in rb


def test_backfill_dim_history_cmd(monkeypatch, tmp_path) -> None:
    zip_path = _write_zip(tmp_path / "gtfs.zip")
    called = {}

    def fake(provider_id, *, gtfs_zip_path, settings=None, registry=None):  # noqa: ANN001, ARG001
        called["provider_id"] = provider_id
        called["gtfs_zip_path"] = gtfs_zip_path
        return DimHistoryBackfillResult(
            provider_id=provider_id,
            gtfs_zip_path=str(gtfs_zip_path),
            row_counts={"dim_route_history_inserted": 12, "dim_stop_history_inserted": 15},
        )

    monkeypatch.setattr(cli, "backfill_dim_name_history", fake)
    result = CliRunner().invoke(
        cli.app, ["backfill-dim-history", "stm", "--from-gtfs-zip", str(zip_path)]
    )

    assert result.exit_code == 0, result.output
    assert called["provider_id"] == "stm"
    assert Path(called["gtfs_zip_path"]) == zip_path
    assert "dim_route_history_inserted" in result.output


def test_backfill_dim_history_cmd_missing_zip_fails(tmp_path) -> None:
    result = CliRunner().invoke(
        cli.app,
        ["backfill-dim-history", "stm", "--from-gtfs-zip", str(tmp_path / "nope.zip")],
    )
    assert result.exit_code != 0


def test_backfill_zip_helper_roundtrip() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("routes.txt", ROUTES_TXT)
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as zf:
        assert "routes.txt" in zf.namelist()
