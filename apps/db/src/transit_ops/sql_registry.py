from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.sql.elements import TextClause

_REGISTRY: dict[str, str] = {}
_MARKER_PREFIX = "-- q:"
_NAME_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)+$")


def named_query(name: str, sql: str) -> TextClause:
    if not _NAME_RE.match(name):
        raise ValueError(f"invalid query name: {name!r}")
    existing = _REGISTRY.get(name)
    if existing is not None and existing != sql:
        raise ValueError(f"duplicate named_query: {name!r}")
    _REGISTRY[name] = sql
    return text(f"{_MARKER_PREFIX}{name}\n{sql}")


def query_name(statement: object) -> str | None:
    s = str(statement).lstrip()
    if s.startswith(_MARKER_PREFIX):
        return s[len(_MARKER_PREFIX) :].split("\n", 1)[0].strip()
    return None


def registered_names() -> frozenset[str]:
    return frozenset(_REGISTRY)
