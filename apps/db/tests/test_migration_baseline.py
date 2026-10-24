from hashlib import sha256
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

DB_ROOT = Path(__file__).resolve().parents[1]
VERSIONS = DB_ROOT / "src/transit_ops/db/migrations/versions"
BASELINE = "0093_alert_publication_provenance"
BASELINE_FILE = VERSIONS / f"{BASELINE}.py"
BASELINE_SHA256 = "668be1c6d12bd829e2d74d052082430cb80a7c32ca515815430994489d203b93"


def _scripts() -> ScriptDirectory:
    config = Config(str(DB_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(VERSIONS.parent))
    return ScriptDirectory.from_config(config)


def test_revision_graph_has_one_baseline_root() -> None:
    roots = [revision for revision in _scripts().walk_revisions() if revision.down_revision is None]
    assert [revision.revision for revision in roots] == [BASELINE]
    assert roots[0].down_revision is None


def test_revision_graph_has_one_head() -> None:
    assert len(_scripts().get_heads()) == 1


def test_applied_baseline_file_is_frozen() -> None:
    # An applied baseline is immutable; schema changes belong in new revisions.
    text = BASELINE_FILE.read_text(encoding="utf-8")
    assert sha256(text.encode("utf-8")).hexdigest() == BASELINE_SHA256
