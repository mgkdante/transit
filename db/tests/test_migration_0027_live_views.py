import importlib.util, pathlib


def _load():
    p = pathlib.Path(__file__).resolve().parents[1] / "src/transit_ops/db/migrations/versions/0027_live_promotion_views.py"
    spec = importlib.util.spec_from_file_location("m0027", p)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def test_0027_chain_and_objects():
    m = _load()
    assert m.down_revision == "0026_map_route_lines_route_id"
    blob = m._CREATE_STOP_NEXT_DEPARTURES + m._CREATE_NON_RESPONDING
    assert "gold.current_stop_next_departures" in blob
    assert "gold.non_responding_current" in blob
    assert "DROP VIEW IF EXISTS gold.current_stop_next_departures" in m._DROP
    # correctness fixes locked in:
    assert "GROUP BY provider_id" in m._CREATE_STOP_NEXT_DEPARTURES  # P1 per-provider latest snapshot
    assert "exception_type = 2" in m._CREATE_NON_RESPONDING  # non_responding subtracts cancelled services
