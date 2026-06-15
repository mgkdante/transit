import importlib.util
import inspect
import pathlib

_MIGRATION = "src/transit_ops/db/migrations/versions/0029_dim_name_history.py"


def _load():
    p = pathlib.Path(__file__).resolve().parents[1] / _MIGRATION
    spec = importlib.util.spec_from_file_location("m0029", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_0029_chain():
    m = _load()
    assert m.revision == "0029_dim_name_history"
    assert m.down_revision == "0028_historic_promotion_marts"
    assert callable(m.upgrade) and callable(m.downgrade)


def test_0029_creates_and_seeds_history():
    src = inspect.getsource(_load())
    assert "dim_route_history" in src
    assert "dim_stop_history" in src
    # at most one open row per (provider, natural key)
    assert "WHERE valid_to_utc IS NULL" in src
    # seeded from the CURRENT dims so this edition's names are captured at apply time
    assert "FROM gold.dim_route" in src
    assert "FROM gold.dim_stop" in src


def test_0029_no_dataset_version_fk():
    """prune_static_silver_datasets DELETEs old core.dataset_versions rows every
    realtime cycle — an FK from the append-only history tables would block it."""
    src = inspect.getsource(_load())
    assert "core.dataset_versions.dataset_version_id" not in src
