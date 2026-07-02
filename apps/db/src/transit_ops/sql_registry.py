"""Named-query registry: stamp every executed SQL constant with a stable identity.

`named_query(name, sql)` prepends a leading `-- q:<name>` comment line to the SQL
and records the name. The marker is an inert leading SQL comment, so query plans and
published bytes are unchanged; it exists so tests dispatch on an exact query identity
instead of fragile SELECT-column substrings, and so EXPLAIN output is self-labelling.

Duplicate names raise at import time — the registry is the single source of query
identity that C2/C3 rename/move constants against.
"""

from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.sql.elements import TextClause

_REGISTRY: dict[str, str] = {}
_MARKER_PREFIX = "-- q:"
_NAME_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)+$")


def named_query(name: str, sql: str) -> TextClause:
    """Register `name` and return text() with a leading `-- q:<name>` marker line.

    A different SQL body under an existing name -> ValueError (a genuine collision).
    Re-registering the SAME body is idempotent, so runtime factories that rebuild an
    identical parameterized statement (e.g. per-kind rebuild deletes) never raise.
    Name must be lowercase, dot-namespaced.
    """
    if not _NAME_RE.match(name):
        raise ValueError(f"invalid query name: {name!r}")
    existing = _REGISTRY.get(name)
    if existing is not None and existing != sql:
        raise ValueError(f"duplicate named_query: {name!r}")
    _REGISTRY[name] = sql
    return text(f"{_MARKER_PREFIX}{name}\n{sql}")


def query_name(statement: object) -> str | None:
    """Extract the `-- q:<name>` token from a rendered statement. None if absent."""
    s = str(statement).lstrip()
    if s.startswith(_MARKER_PREFIX):
        return s[len(_MARKER_PREFIX) :].split("\n", 1)[0].strip()
    return None


def registered_names() -> frozenset[str]:
    return frozenset(_REGISTRY)
