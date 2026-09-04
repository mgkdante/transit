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
