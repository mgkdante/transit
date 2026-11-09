import sqlite3

import pytest
from test_snapshots_builders import FakeConn, FakeResult

from transit_ops.snapshots.builders.live import build_network
from transit_ops.sql_registry import query_name


@pytest.mark.parametrize("provider", ["stm", "octranspo"])
def test_network_excludes_untripped_positions(provider):
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("ATTACH DATABASE ':memory:' AS gold")
    db.execute(
        "CREATE TABLE gold.current_vehicle_map_with_status "
        "(provider_id, realtime_snapshot_id, entity_index, trip_id, status_band)"
    )
    db.execute(
        "CREATE TABLE gold.latest_vehicle_snapshot "
        "(provider_id, realtime_snapshot_id, entity_index, occupancy_status)"
    )
    for i, (trip, status, occupancy) in enumerate(
        [
            ("t1", "À l'heure / On time", 1),
            ("t2", "Critique / Severe", 5),
            ("t3", "Inconnu / Unknown", None),
            (None, "Inconnu / Unknown", None),
            ("", "À l'heure / On time", 0),
        ]
    ):
        db.execute(
            "INSERT INTO gold.current_vehicle_map_with_status VALUES (?, 1, ?, ?, ?)",
            (provider, i, trip, status),
        )
        db.execute(
            "INSERT INTO gold.latest_vehicle_snapshot VALUES (?, 1, ?, ?)", (provider, i, occupancy)
        )

    class Conn(FakeConn):
        def execute(self, statement, params=None):
            if query_name(statement) == "network.live.vehicles":
                return FakeResult(db.execute(str(statement), params).fetchall())
            return super().execute(statement, params)

    try:
        result = build_network(
            Conn({"network.live.freshness": [0]}),
            provider_id=provider,
            generated_utc="2026-05-31T12:00:05Z",
        )
        assert result.vehicles_in_service == 3
        assert result.status_dist.model_dump() == dict(
            early=0,
            on_time=1,
            late=0,
            severe=1,
            unknown=1,
        )
        assert result.coverage_pct == 67
        assert result.on_time_pct == 50
        assert result.occupancy_mix.many_seats == 0.5
        assert result.occupancy_mix.full == 0.5
        assert result.occupancy_mix.empty == 0
    finally:
        db.close()
