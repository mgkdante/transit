import pytest

from transit_ops.db.connection import make_engine, require_database_url
from transit_ops.settings import Settings


def test_require_database_url_raises_generic_error_when_missing() -> None:
    settings = Settings(_env_file=None)

    with pytest.raises(
        ValueError, match="^DATABASE_URL is required for database commands\\.$"
    ):
        require_database_url(settings)


def test_make_engine_raises_generic_error_when_missing() -> None:
    settings = Settings(_env_file=None)

    with pytest.raises(
        ValueError, match="^DATABASE_URL is required for database commands\\.$"
    ):
        make_engine(settings)
