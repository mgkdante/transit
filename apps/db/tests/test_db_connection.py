from pathlib import Path

import pytest
import yaml
from sqlalchemy import text

from transit_ops.db.connection import make_engine, require_database_url
from transit_ops.settings import Settings


def test_require_database_url_raises_generic_error_when_missing() -> None:
    settings = Settings(_env_file=None)

    with pytest.raises(ValueError, match="^DATABASE_URL is required for database commands\\.$"):
        require_database_url(settings)


def test_make_engine_raises_generic_error_when_missing() -> None:
    settings = Settings(_env_file=None)

    with pytest.raises(ValueError, match="^DATABASE_URL is required for database commands\\.$"):
        make_engine(settings)


@pytest.mark.parametrize("service", ["worker", "pruner", "health"])
def test_compose_database_sessions_identify_their_service(
    real_db_engine, monkeypatch, service
) -> None:
    compose = yaml.safe_load(
        (Path(__file__).resolve().parents[1] / "docker-compose.yml").read_text()
    )
    environment = compose["services"][service]["environment"]
    monkeypatch.setenv("PGAPPNAME", environment.get("PGAPPNAME", ""))
    settings = Settings(
        DATABASE_URL=real_db_engine.url.render_as_string(hide_password=False),
        _env_file=None,
    )
    engine = make_engine(settings)
    try:
        with engine.connect() as connection:
            application_name = connection.execute(
                text("SELECT application_name FROM pg_stat_activity WHERE pid = pg_backend_pid()")
            ).scalar_one()
            assert application_name == f"transit-{service}"
    finally:
        engine.dispose()
