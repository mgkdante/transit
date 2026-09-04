"""Connection-free database target validation."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import unquote

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_POSTGRESQL_DEFAULT_PORT = 5432
_DISPOSABLE_CONFIRMATION = "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
_DISPOSABLE_TARGETS = frozenset(
    {
        ("transit_ci", "transit_ci"),
        ("postgres", "transit_test"),
        ("repro", "transit_repro"),
    }
)


@dataclass(frozen=True)
class DatabaseTarget:
    """Password-free identity of a PostgreSQL connection target."""

    backend: str
    username: str | None
    host: str | None
    port: int
    database: str | None
    query: tuple[tuple[str, str], ...]


def _query_pairs(query: Mapping[str, str | tuple[str, ...]]) -> tuple[tuple[str, str], ...]:
    pairs: list[tuple[str, str]] = []
    for key, value in query.items():
        values = value if isinstance(value, tuple) else (value,)
        for item in values:
            normalized = _normalize_host_target(str(item)) if key == "host" else str(item)
            pairs.append((str(key), normalized))
    return tuple(sorted(pairs))


def _normalize_host_target(host: str) -> str:
    return ",".join(part if part.startswith("/") else part.lower() for part in host.split(","))


def parse_database_target(url: str) -> DatabaseTarget:
    """Parse a PostgreSQL URL into a normalized identity without its password."""

    try:
        parsed = make_url(url)
        backend = parsed.drivername.split("+", 1)[0]
        if backend == "postgres":
            backend = "postgresql"
        if backend != "postgresql":
            raise ValueError
        port = parsed.port or _POSTGRESQL_DEFAULT_PORT
    except (ArgumentError, TypeError, ValueError):
        raise RuntimeError(
            "Database target parsing policy failed "
            "(host='<unknown>', database='<unknown>', role='<unknown>'): "
            "expected a valid PostgreSQL URL."
        ) from None

    host = parsed.host
    if host is not None and not host.startswith("/"):
        host = host.lower()

    return DatabaseTarget(
        backend=backend,
        username=parsed.username,
        host=host,
        port=port,
        database=unquote(parsed.database) if parsed.database is not None else None,
        query=_query_pairs(parsed.query),
    )


def _display(value: object | None) -> str:
    return "<unset>" if value is None or value == "" else str(value)


def _summary(target: DatabaseTarget) -> str:
    return (
        f"host='{_display(_diagnostic_host(target))}', "
        f"database='{_display(target.database)}', role='{_display(target.username)}'"
    )


def _query_hosts(target: DatabaseTarget) -> tuple[str, ...]:
    return tuple(value for key, value in target.query if key == "host")


def _diagnostic_host(target: DatabaseTarget) -> str | None:
    query_hosts = _query_hosts(target)
    return target.host or (query_hosts[0] if query_hosts else None)


def _is_local_host(host: str) -> bool:
    return host.lower() in _LOOPBACK_HOSTS or host.startswith("/")


def _target_hosts(target: DatabaseTarget) -> tuple[str, ...]:
    declared_hosts = tuple(value for value in (target.host, *_query_hosts(target)) if value)
    return tuple(part for host in declared_hosts for part in host.split(","))


def _is_local_migration_target(target: DatabaseTarget) -> bool:
    hosts = _target_hosts(target)
    return not hosts or all(_is_local_host(host) for host in hosts)


def _is_disposable_local_target(target: DatabaseTarget) -> bool:
    hosts = _target_hosts(target)
    return bool(hosts) and all(_is_local_host(host) for host in hosts)


def assert_explicit_remote_url(url: str, environment: Mapping[str, str]) -> None:
    """Require an explicit, semantically matching process URL for remote migrations."""

    target = parse_database_target(url)
    if _is_local_migration_target(target):
        return

    process_url = environment.get("DATABASE_URL", "").strip()
    if process_url:
        try:
            explicit_target = parse_database_target(process_url)
        except RuntimeError:
            explicit_target = None
        if explicit_target == target:
            return

    raise RuntimeError(
        f"Migration database target policy failed ({_summary(target)}): remote migrations "
        "require a nonempty process DATABASE_URL selecting the same target."
    )


def assert_disposable_test_url(url: str, environment: Mapping[str, str]) -> None:
    """Require a confirmed local PostgreSQL target with an approved test identity."""

    target = parse_database_target(url)
    confirmed = environment.get("TRANSIT_TEST_DATABASE_DISPOSABLE") == _DISPOSABLE_CONFIRMATION
    approved_pair = (target.username, target.database) in _DISPOSABLE_TARGETS
    if _is_disposable_local_target(target) and approved_pair and confirmed:
        return

    raise RuntimeError(
        f"Disposable test database target policy failed ({_summary(target)}): expected an "
        "approved local database/role pair and exact TRANSIT_TEST_DATABASE_DISPOSABLE "
        "confirmation."
    )
