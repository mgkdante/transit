import os
from urllib.parse import unquote

import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from sqlalchemy.engine import make_url

from transit_ops.db.target_safety import (
    assert_disposable_test_url,
    assert_explicit_remote_url,
    parse_database_target,
    resolve_database_target,
)

CONFIRM = {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"}
LOCAL = "postgresql+psycopg://transit_ci@localhost/transit_ci"


@pytest.mark.parametrize("nul", ["%00", "\x00"])
@pytest.mark.parametrize(
    "url",
    [
        "postgresql://transit_ciNUL@localhost/transit_ci",
        "postgresql://transit_ci:pwNUL@localhost/transit_ci",
        "postgresql://transit_ci@localhostNUL/transit_ci",
        "postgresql://transit_ci@localhost/transit_ciNUL",
        "postgresql://transit_ci@localhost/transit_ci?passNULfile=x",
        "postgresql://transit_ci@localhost/transit_ci?passfile=xNUL",
    ],
)
def test_nul_is_refused_by_shared_parsing_and_both_policies(url, nul):
    url = url.replace("NUL", nul)
    for check in (
        lambda: parse_database_target(url),
        lambda: assert_disposable_test_url(url, CONFIRM),
        lambda: assert_explicit_remote_url(url, CONFIRM),
    ):
        with pytest.raises(RuntimeError, match="Database target parsing policy failed"):
            check()


@pytest.mark.parametrize("key", ["conninfo", "dsn", "service", "servicefile", "unknown"])
def test_unpermitted_query_keys_are_refused(key):
    with pytest.raises(RuntimeError, match="Database target parsing policy failed"):
        assert_disposable_test_url(f"{LOCAL}?{key}=unused", CONFIRM)


@pytest.mark.parametrize(
    "query",
    [
        "sslmode=require",
        "passfile=unused",
        "options=-c%20search_path=public",
        "application_name=test",
        "connect_timeout=2",
    ],
)
def test_permitted_libpq_options_remain_accepted(query):
    assert_disposable_test_url(f"{LOCAL}?{query}", CONFIRM)


def test_policy_resolves_driver_port_without_changing_declared_parser():
    url = "postgresql+psycopg://transit@remote.invalid:0/transit"
    args, kwargs = make_url(url).get_dialect()().create_connect_args(make_url(url))
    actual = conninfo_to_dict(make_conninfo(*args, **kwargs))
    assert (actual.get("port") or "6543") == "6543"
    assert parse_database_target(url).port == 0
    assert_explicit_remote_url(
        url, {"PGPORT": "6543", "DATABASE_URL": "postgresql://transit@remote.invalid:6543/transit"}
    )


@pytest.mark.parametrize(
    "url",
    [
        LOCAL,
        "postgresql+psycopg://?passfile=x%00&host=localhost&hostaddr=127.0.0.1&user=transit_ci&dbname=transit_ci",
        "postgresql+psycopg://transit_ci:pw%00@localhost/transit_ci?hostaddr=127.0.0.1",
    ],
)
def test_recheck_cases_match_the_identity_libpq_parses(url, monkeypatch):
    defaults = {
        "host": "localhost",
        "hostaddr": "300.1.1.1",
        "port": "1",
        "user": "transit_ci",
        "dbname": "transit_ci",
    }
    for key, value in defaults.items():
        monkeypatch.setenv("PGDATABASE" if key == "dbname" else "PG" + key.upper(), value)
    monkeypatch.delenv("PGSERVICE", raising=False)
    monkeypatch.delenv("PGSERVICEFILE", raising=False)
    parsed = make_url(url)
    args, kwargs = parsed.get_dialect()().create_connect_args(parsed)
    actual = conninfo_to_dict(make_conninfo(*args, **kwargs))
    assert tuple(actual.get(key) or defaults[key] for key in defaults) == (
        "localhost",
        "300.1.1.1",
        "1",
        "transit_ci",
        "transit_ci",
    )
    if "\x00" not in unquote(url):
        target = resolve_database_target(url, os.environ)
        assert (target.host, target.hostaddr, target.port, target.username, target.database) == (
            "localhost",
            "300.1.1.1",
            1,
            "transit_ci",
            "transit_ci",
        )
    with pytest.raises(RuntimeError):
        assert_disposable_test_url(url, dict(os.environ) | CONFIRM)
