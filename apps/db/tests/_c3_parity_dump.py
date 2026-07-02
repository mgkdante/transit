"""C3 parity dump: seed a disposable DB, build every historic payload, dump JSON.

Run BEFORE (C1+C2 working tree) and AFTER (C1+C2+C3 split) and byte-compare the
two JSON dirs excluding generated_utc. Reuses the cutover-gate seed harness so the
seed is a single owner. Not a pytest module (import-time DB_URL gate would skip it);
invoked directly with TRANSIT_TEST_DATABASE_URL set.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import create_engine

# Reuse the cutover-gate seed + no-commit engine (single owner of the seed).
from test_spine_cutover_gate import (
    GENERATED_UTC,
    PROVIDER,
    ROUTE,
    _build,
    _seed,
)

from transit_ops.snapshots.builders.historic import (
    build_alert_history,
    build_hotspots,
    build_network_trend,
    build_provenance,
    build_receipts,
    build_repeat_offenders,
    build_route_reliability,
    build_stop_reliability,
)


def _dump(obj) -> str:
    """model | dict-of-models -> stable JSON string (generated_utc stripped)."""

    def _strip(v):  # noqa: ANN001, ANN202
        if hasattr(v, "model_dump"):
            v = v.model_dump(mode="json")
        if isinstance(v, dict):
            return {k: _strip(x) for k, x in v.items() if k != "generated_utc"}
        if isinstance(v, list):
            return [_strip(x) for x in v]
        return v

    return json.dumps(_strip(obj), sort_keys=True, indent=2)


def main(out_dir: str) -> None:
    url = __import__("os").environ["TRANSIT_TEST_DATABASE_URL"]
    engine = create_engine(url)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with engine.begin() as conn:
        _seed(conn)
        _build(conn)

        payloads = {
            "network_trend": build_network_trend(
                conn, provider_id=PROVIDER, generated_utc=GENERATED_UTC
            ),
            "route_reliability": build_route_reliability(
                conn, provider_id=PROVIDER, route_id=ROUTE, generated_utc=GENERATED_UTC
            ),
            "stop_reliability": build_stop_reliability(
                conn, provider_id=PROVIDER, generated_utc=GENERATED_UTC
            ),
            "hotspots": build_hotspots(conn, PROVIDER, generated_utc=GENERATED_UTC),
            "repeat_offenders": build_repeat_offenders(conn, PROVIDER, generated_utc=GENERATED_UTC),
            "receipts": build_receipts(conn, PROVIDER, generated_utc=GENERATED_UTC),
            "alert_history": build_alert_history(conn, PROVIDER, generated_utc=GENERATED_UTC),
            "provenance": build_provenance(conn, PROVIDER, generated_utc=GENERATED_UTC),
        }
        conn.rollback()  # never persist the seed

    sizes = {}
    for name, payload in payloads.items():
        text = _dump(payload)
        (out / f"{name}.json").write_text(text)
        # non-trivial gauge: character length of the stripped JSON
        sizes[name] = len(text)
    print(json.dumps(sizes, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
