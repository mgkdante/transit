import importlib.util, pathlib


def _load():
    p = pathlib.Path(__file__).resolve().parents[1] / "src/transit_ops/db/migrations/versions/0028_historic_promotion_marts.py"
    spec = importlib.util.spec_from_file_location("m0028", p)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def test_0028_chain():
    m = _load()
    assert m.revision == "0028_historic_promotion_marts"
    assert m.down_revision == "0027_live_promotion_views"
    assert callable(m.upgrade) and callable(m.downgrade)

def test_0028_creates_marts():
    import inspect
    src = inspect.getsource(_load())
    assert "gold.route_headway_daily" in src or "route_headway_daily" in src
    assert "repeat_offender_daily" in src

def test_retention_bumped_to_14():
    from transit_ops.settings import Settings
    s = Settings(_env_file=None, DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.GOLD_FACT_RETENTION_DAYS == 14
