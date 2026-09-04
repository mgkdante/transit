"""Connection-free database target validation."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_POSTGRESQL_DEFAULT_PORT = 5432
_DIAGNOSTIC_FIELD_LIMIT = 120
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


def _expanded_ports(ports: tuple[int | None, ...], host_count: int) -> tuple[int, ...]:
    if len(ports) == 1:
        port = ports[0] if ports[0] is not None else _POSTGRESQL_DEFAULT_PORT
        return (port,) * host_count
    if len(ports) != host_count:
        raise ValueError
    return tuple(port if port is not None else _POSTGRESQL_DEFAULT_PORT for port in ports)


def _collapsed_ports(ports: tuple[int, ...]) -> int | tuple[int, ...]:
    return ports[0] if len(set(ports)) == 1 else ports


def _query_host_fallback_ports(
    host_count: int,
    authority_port: int | None,
    environment_port: tuple[int | None, ...] | None,
) -> tuple[int | None, ...]:
    if host_count > 1:
        return (_POSTGRESQL_DEFAULT_PORT,)
    if authority_port is not None:
        return (authority_port,)
    return environment_port or (_POSTGRESQL_DEFAULT_PORT,)


def _effective_host_and_port(
    authority_host: str | None,
    authority_port: int | None,
    query: Mapping[str, str | tuple[str, ...]],
    environment_port: tuple[int | None, ...] | None,
) -> tuple[str | None, int | tuple[int, ...]]:
    host_values = _query_values(query, "host")
    port_values = _query_values(query, "port")

    if not host_values:
        host_count = len(authority_host.split(",")) if authority_host else 1
        if port_values:
            ports = _parse_ports(port_values)
        elif authority_port is not None:
            ports = (authority_port,)
        elif environment_port is not None:
            ports = environment_port
        else:
            ports = (_POSTGRESQL_DEFAULT_PORT,)
        effective_ports = _expanded_ports(ports, host_count)
        return (
            _normalize_host(authority_host) if authority_host is not None else None,
            _collapsed_ports(effective_ports),
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
        effective_ports = _expanded_ports(_parse_ports(port_values), len(hosts))
    elif inline_ports is not None:
        fallback_ports = _query_host_fallback_ports(len(hosts), authority_port, environment_port)
        expanded_fallback = _expanded_ports(fallback_ports, len(hosts))
        effective_ports = tuple(
            port if port is not None else expanded_fallback[index]
            for index, port in enumerate(inline_ports)
        )
    else:
        fallback_ports = _query_host_fallback_ports(len(hosts), authority_port, environment_port)
        effective_ports = _expanded_ports(fallback_ports, len(hosts))

    if len(effective_ports) != len(hosts):
        raise ValueError
    normalized_hosts = tuple(_normalize_host(host) for host in hosts)
    return ",".join(normalized_hosts), _collapsed_ports(effective_ports)


def _effective_hostaddr(
    query: Mapping[str, str | tuple[str, ...]],
    environment: Mapping[str, str],
) -> str | None:
    value = _single_query_value(query, "hostaddr")
    if value is None:
        value = _environment_value(environment, "PGHOSTADDR")
    if value is None:
        return None
    return ",".join(_normalize_host(host) for host in value.split(","))


def _environment_value(environment: Mapping[str, str], key: str) -> str | None:
    return environment.get(key) or None


def _parsing_policy_error() -> RuntimeError:
    return RuntimeError(
        "Database target parsing policy failed "
        "(host='<unknown>', database='<unknown>', role='<unknown>'): "
        "expected a valid PostgreSQL URL."
    )


def _parse_database_target(url: str, environment: Mapping[str, str]) -> DatabaseTarget:
    try:
        if any(_environment_value(environment, key) for key in ("PGSERVICE", "PGSERVICEFILE")):
            raise ValueError
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
            username = (
                parsed.username
                if parsed.username is not None
                else _environment_value(environment, "PGUSER")
            )
        database: str | None
        database_override = _single_query_value(parsed.query, "dbname")
        if database_override is not None:
            database = database_override
        elif parsed.database is not None:
            database = parsed.database
        else:
            database = _environment_value(environment, "PGDATABASE")
        host = parsed.host if parsed.host is not None else _environment_value(environment, "PGHOST")
        environment_port_value = _environment_value(environment, "PGPORT")
        environment_port = (
            _parse_ports((environment_port_value,)) if environment_port_value is not None else None
        )
        host, port = _effective_host_and_port(
            host,
            parsed.port,
            parsed.query,
            environment_port,
        )
        hostaddr = _effective_hostaddr(parsed.query, environment)
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


def parse_database_target(url: str) -> DatabaseTarget:
    """Parse a PostgreSQL URL into a normalized identity without its password."""

    return _parse_database_target(url, {})


def _display(value: object | None) -> str:
    if value is None or value == "":
        return "<unset>"
    escaped = json.dumps(str(value), ensure_ascii=True)[1:-1]
    if len(escaped) <= _DIAGNOSTIC_FIELD_LIMIT:
        return escaped
    return escaped[: _DIAGNOSTIC_FIELD_LIMIT - 3] + "..."


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


def _is_local_target(target: DatabaseTarget) -> bool:
    hosts = _target_hosts(target)
    return bool(hosts) and all(_is_local_host(host) for host in hosts)


def assert_explicit_remote_url(url: str, environment: Mapping[str, str]) -> None:
    """Require an explicit, semantically matching process URL for remote migrations."""

    target = _parse_database_target(url, environment)
    if _is_local_target(target):
        return

    process_url = environment.get("DATABASE_URL", "").strip()
    if process_url:
        try:
            explicit_target = _parse_database_target(process_url, environment)
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

    target = _parse_database_target(url, environment)
    confirmed = environment.get("TRANSIT_TEST_DATABASE_DISPOSABLE") == _DISPOSABLE_CONFIRMATION
    approved_pair = (target.username, target.database) in _DISPOSABLE_TARGETS
    if _is_local_target(target) and approved_pair and confirmed:
        return

    raise RuntimeError(
        f"Disposable test database target policy failed ({_summary(target)}): expected an "
        "approved local database/role pair and exact TRANSIT_TEST_DATABASE_DISPOSABLE "
        "confirmation."
    )
