"""Connection-free database target validation."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import unquote

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_POSTGRESQL_DEFAULT_PORT = 5432
_CONNECTION_IDENTITY_QUERY_KEYS = frozenset({"user", "dbname", "host", "hostaddr", "port"})
_CREDENTIAL_QUERY_KEYS = frozenset({"password", "sslpassword"})
_UNRESOLVABLE_TARGET_QUERY_KEYS = frozenset({"service", "servicefile"})
_INLINE_HOST_PORT = re.compile(r"^([a-zA-Z0-9\-.]*)(?::(\d*))?$")
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
    port: int | tuple[int, ...]
    database: str | None
    query: tuple[tuple[str, str], ...]
    hostaddr: str | None = None


def _query_pairs(query: Mapping[str, str | tuple[str, ...]]) -> tuple[tuple[str, str], ...]:
    pairs: list[tuple[str, str]] = []
    for key, value in query.items():
        if key in _CONNECTION_IDENTITY_QUERY_KEYS or key in _CREDENTIAL_QUERY_KEYS:
            continue
        values = value if isinstance(value, tuple) else (value,)
        pairs.extend((str(key), str(item)) for item in values)
    return tuple(sorted(pairs))


def _query_values(query: Mapping[str, str | tuple[str, ...]], key: str) -> tuple[str, ...]:
    value = query.get(key)
    if value is None:
        return ()
    return tuple(str(item) for item in value) if isinstance(value, tuple) else (str(value),)


def _single_query_value(query: Mapping[str, str | tuple[str, ...]], key: str) -> str | None:
    values = _query_values(query, key)
    if not values:
        return None
    if len(values) != 1:
        raise ValueError
    return values[0]


def _normalize_host(host: str) -> str:
    return host if host.startswith("/") else host.lower()


def _parse_ports(values: tuple[str, ...]) -> tuple[int | None, ...]:
    if len(values) == 1:
        values = tuple(values[0].split(","))
    return tuple(int(value) if value else None for value in values)


def _effective_host_and_port(
    authority_host: str | None,
    authority_port: int | None,
    query: Mapping[str, str | tuple[str, ...]],
) -> tuple[str | None, int | tuple[int, ...]]:
    base_port = authority_port if authority_port is not None else _POSTGRESQL_DEFAULT_PORT
    host_values = _query_values(query, "host")
    port_values = _query_values(query, "port")

    if not host_values:
        ports = _parse_ports(port_values) if port_values else (base_port,)
        if len(ports) != 1:
            raise ValueError
        effective_port = ports[0] if ports[0] is not None else _POSTGRESQL_DEFAULT_PORT
        return (
            _normalize_host(authority_host) if authority_host is not None else None,
            effective_port,
        )

    inline_ports: tuple[int | None, ...] | None = None
    if len(host_values) > 1:
        if port_values:
            raise ValueError
        split_hosts: list[str] = []
        split_ports: list[int | None] = []
        for value in host_values:
            parts = value.split(":") if ":" in value else [value, ""]
            if len(parts) != 2:
                raise ValueError
            split_hosts.append(parts[0])
            split_ports.append(int(parts[1]) if parts[1] else None)
        hosts = tuple(split_hosts)
        inline_ports = tuple(split_ports)
    else:
        hosts = tuple(host_values[0].split(","))
        if not port_values and len(hosts) == 1 and ":" in hosts[0]:
            match = _INLINE_HOST_PORT.fullmatch(hosts[0])
            if match is not None:
                hosts = (match.group(1),)
                inline_ports = (int(match.group(2)) if match.group(2) else None,)

    if port_values:
        parsed_ports = _parse_ports(port_values)
        if len(parsed_ports) != len(hosts) and (len(parsed_ports) > 1 or len(hosts) > 1):
            raise ValueError
        effective_ports = tuple(
            port if port is not None else _POSTGRESQL_DEFAULT_PORT for port in parsed_ports
        )
    elif inline_ports is not None:
        parsed_ports = inline_ports
        if len(hosts) == 1 and parsed_ports == (None,):
            effective_ports = (base_port,)
        else:
            effective_ports = tuple(
                port if port is not None else _POSTGRESQL_DEFAULT_PORT for port in parsed_ports
            )
    else:
        effective_ports = tuple(
            base_port if len(hosts) == 1 else _POSTGRESQL_DEFAULT_PORT for _ in hosts
        )

    if len(effective_ports) != len(hosts):
        raise ValueError
    normalized_hosts = tuple(_normalize_host(host) for host in hosts)
    port: int | tuple[int, ...]
    if len(set(effective_ports)) == 1:
        port = effective_ports[0]
    else:
        port = effective_ports
    return ",".join(normalized_hosts), port


def _effective_hostaddr(
    query: Mapping[str, str | tuple[str, ...]],
) -> str | None:
    value = _single_query_value(query, "hostaddr")
    if value is None:
        return None
    return ",".join(_normalize_host(host) for host in value.split(","))


def _parsing_policy_error() -> RuntimeError:
    return RuntimeError(
        "Database target parsing policy failed "
        "(host='<unknown>', database='<unknown>', role='<unknown>'): "
        "expected a valid PostgreSQL URL."
    )


def parse_database_target(url: str) -> DatabaseTarget:
    """Parse a PostgreSQL URL into a normalized identity without its password."""

    try:
        parsed = make_url(url)
        backend = parsed.drivername.split("+", 1)[0]
        if backend == "postgres":
            backend = "postgresql"
        if backend != "postgresql":
            raise ValueError
        if _UNRESOLVABLE_TARGET_QUERY_KEYS.intersection(parsed.query):
            raise ValueError
        username = _single_query_value(parsed.query, "user")
        if username is None:
            username = parsed.username
        database_override = _single_query_value(parsed.query, "dbname")
        if database_override is not None:
            database = database_override
        elif parsed.database is not None:
            database = unquote(parsed.database)
        else:
            database = None
        host, port = _effective_host_and_port(parsed.host, parsed.port, parsed.query)
        hostaddr = _effective_hostaddr(parsed.query)
    except (ArgumentError, TypeError, ValueError):
        raise _parsing_policy_error() from None

    return DatabaseTarget(
        backend=backend,
        username=username,
        host=host,
        port=port,
        database=database,
        query=_query_pairs(parsed.query),
        hostaddr=hostaddr,
    )


def _display(value: object | None) -> str:
    return "<unset>" if value is None or value == "" else str(value)


def _summary(target: DatabaseTarget) -> str:
    return (
        f"host='{_display(_diagnostic_host(target))}', "
        f"database='{_display(target.database)}', role='{_display(target.username)}'"
    )


def _diagnostic_host(target: DatabaseTarget) -> str | None:
    return target.hostaddr or target.host


def _is_local_host(host: str) -> bool:
    return host.lower() in _LOOPBACK_HOSTS or host.startswith("/")


def _target_hosts(target: DatabaseTarget) -> tuple[str, ...]:
    declared_hosts = tuple(value for value in (target.host, target.hostaddr) if value)
    return tuple(part for host in declared_hosts for part in host.split(","))


def _is_local_migration_target(target: DatabaseTarget) -> bool:
    hosts = _target_hosts(target)
    return bool(hosts) and all(_is_local_host(host) for host in hosts)


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
