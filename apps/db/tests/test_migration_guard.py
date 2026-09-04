"""Database migration target intent tests."""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from transit_ops.db.migration_guard import assert_explicit_remote_url
from transit_ops.db.target_safety import DatabaseTarget, parse_database_target

_REMOTE = "postgresql+psycopg://transit:pw@db.transit.example.com:5432/transit?sslmode=require"


def test_database_target_is_normalized_decoded_immutable_and_password_free() -> None:
    target = parse_database_target(
        "postgres://Op%20User:super-secret@DB.Example.COM/my%2Fdb"
        "?sslmode=require&application_name=transit"
    )

    assert target == DatabaseTarget(
        backend="postgresql",
        username="Op User",
        host="db.example.com",
        port=5432,
        database="my/db",
        query=(("application_name", "transit"), ("sslmode", "require")),
    )
    assert "super-secret" not in repr(target)
    with pytest.raises(FrozenInstanceError):
        target.host = "other.example.com"  # type: ignore[misc]


def test_query_password_is_removed_from_target_identity_and_representation() -> None:
    first = parse_database_target(
        "postgresql://transit@db.example.com/transit?password=first-secret&sslmode=require"
    )
    second = parse_database_target(
        "postgresql://transit@db.example.com/transit?password=second-secret&sslmode=require"
    )

    assert first == second
    assert first.query == (("sslmode", "require"),)
    assert "first-secret" not in repr(first)
    assert "second-secret" not in repr(second)


def test_query_database_override_is_decoded_exactly_once() -> None:
    target = parse_database_target("postgresql://transit@localhost/ignored?dbname=my%252Fdb")

    assert target.database == "my%2Fdb"


def test_implicit_remote_url_is_refused() -> None:
    with pytest.raises(RuntimeError, match="db.transit.example.com"):
        assert_explicit_remote_url(_REMOTE, {})


def test_remote_url_requires_process_database_url_to_select_the_same_target() -> None:
    different_url = (
        "postgresql://transit:other-secret@db.transit.example.com:5432/analytics?sslmode=require"
    )

    with pytest.raises(RuntimeError, match="Migration database target policy failed") as exc:
        assert_explicit_remote_url(_REMOTE, {"DATABASE_URL": different_url})

    message = str(exc.value)
    assert "host='db.transit.example.com'" in message
    assert "database='transit'" in message
    assert "role='transit'" in message
    assert "pw" not in message
    assert "other-secret" not in message
    assert _REMOTE not in message
    assert different_url not in message


def test_matching_explicit_remote_url_is_driver_and_password_independent() -> None:
    assert_explicit_remote_url(
        _REMOTE,
        {
            "DATABASE_URL": (
                "postgresql://transit:different-secret@DB.TRANSIT.EXAMPLE.COM/transit"
                "?sslmode=require"
            )
        },
    )


def test_matching_query_host_is_dns_case_independent() -> None:
    assert_explicit_remote_url(
        "postgresql://transit@/transit?host=DB.TRANSIT.EXAMPLE.COM&sslmode=require",
        {
            "DATABASE_URL": (
                "postgresql+psycopg://transit:different-secret@/transit"
                "?sslmode=require&host=db.transit.example.com"
            )
        },
    )


def test_query_form_loopback_with_inline_port_is_allowed_for_migrations() -> None:
    assert_explicit_remote_url(
        "postgresql://transit_ci@/transit_ci?host=localhost:5432",
        {},
    )


def test_hostless_target_requires_explicit_process_intent() -> None:
    with pytest.raises(RuntimeError, match="Migration database target policy failed"):
        assert_explicit_remote_url("postgresql://transit@/transit", {})


def test_multihost_without_ports_uses_postgresql_default_not_authority_port() -> None:
    target = parse_database_target(
        "postgresql://transit@ignored.example:5444/transit?host=host-one,host-two"
    )

    assert target.host == "host-one,host-two"
    assert target.port == 5432


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://transit@localhost:0/transit",
        "postgresql://transit@localhost/transit?port=0",
    ],
)
def test_explicit_zero_port_is_not_treated_as_an_omitted_port(database_url: str) -> None:
    assert parse_database_target(database_url).port == 0


def test_query_identity_and_hostaddr_overrides_cannot_hide_remote_target() -> None:
    database_url = (
        "postgresql+psycopg://transit_ci@localhost/transit_ci"
        "?user=postgres&dbname=transit&hostaddr=203.0.113.10&password=query-secret"
    )

    with pytest.raises(RuntimeError, match="Migration database target policy failed") as exc:
        assert_explicit_remote_url(database_url, {})

    message = str(exc.value)
    assert "host='203.0.113.10'" in message
    assert "database='transit'" in message
    assert "role='postgres'" in message
    assert "query-secret" not in message
    assert database_url not in message


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://transit_ci@/transit_ci?host=localhost:5432&host=db.example.invalid:5432",
        "postgresql://transit_ci@localhost/transit_ci?hostaddr=127.0.0.1,203.0.113.10",
    ],
)
def test_any_remote_member_of_query_targets_requires_explicit_intent(
    database_url: str,
) -> None:
    with pytest.raises(RuntimeError, match="Migration database target policy failed"):
        assert_explicit_remote_url(database_url, {})


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://postgres@127.0.0.1:55437/transit_test",
        "postgresql+psycopg://postgres@localhost:5432/transit",
        "postgresql://postgres@[::1]:5432/transit",
    ],
)
def test_implicit_local_urls_are_allowed(url: str) -> None:
    assert_explicit_remote_url(url, {})


def test_driver_suffix_does_not_hide_the_host() -> None:
    with pytest.raises(RuntimeError):
        assert_explicit_remote_url("postgresql+psycopg://u:p@some.remote.host/db", {})


def test_remote_member_of_query_host_list_is_not_treated_as_a_unix_socket() -> None:
    with pytest.raises(RuntimeError, match="Migration database target policy failed"):
        assert_explicit_remote_url(
            "postgresql://repro@/transit_repro?host=/tmp/transit,db.example.invalid",
            {},
        )


@pytest.mark.parametrize(
    "process_url",
    [
        "postgresql://other@db.transit.example.com/transit?sslmode=require",
        "postgresql://transit@other.example.com/transit?sslmode=require",
        "postgresql://transit@db.transit.example.com:5433/transit?sslmode=require",
        "postgresql://transit@db.transit.example.com/other?sslmode=require",
        "postgresql://transit@db.transit.example.com/transit?sslmode=disable",
    ],
)
def test_remote_url_rejects_a_different_semantic_process_target(
    process_url: str,
) -> None:
    with pytest.raises(RuntimeError, match="Migration database target policy failed"):
        assert_explicit_remote_url(_REMOTE, {"DATABASE_URL": process_url})


@pytest.mark.parametrize(
    "url",
    [
        "not a database url containing secret-password",
        "mysql://operator:secret-password@db.example.invalid/transit",
    ],
)
def test_invalid_database_urls_fail_without_echoing_secrets(url: str) -> None:
    with pytest.raises(RuntimeError, match="Database target parsing policy failed") as exc:
        assert_explicit_remote_url(url, {})

    message = str(exc.value)
    assert "secret-password" not in message
    assert url not in message
