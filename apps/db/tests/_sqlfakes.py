"""Shared fake DB connections that dispatch on the `-- q:<name>` registry marker.

Every executed builder/rollup/mart SQL constant carries a stable `-- q:<name>`
marker (transit_ops.sql_registry.named_query). These fakes dispatch canned result
sets by EXACT query name via a dict — no ordering, no substring matching, no
column-alias sniffing. Unmapped names fall through to `[]`, matching the empty
fall-through semantics the substring fakes relied on.
"""

from __future__ import annotations

from transit_ops.sql_registry import query_name


class _FakeResult:
    def __init__(self, rows):  # noqa: ANN001
        self._rows = rows

    def mappings(self):  # noqa: ANN201
        outer = self

        class M:
            def fetchone(self):  # noqa: ANN202
                return outer._rows[0] if outer._rows else None

            def __iter__(self):
                return iter(outer._rows)

        return M()

    def __iter__(self):
        # bare row[0]-style iteration (active-services query)
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        return self._rows[0] if self._rows else None

    def scalar_one(self):  # noqa: ANN201
        return self._rows[0] if self._rows else 0


class NamedQueryConn:
    """Dispatch canned result sets by exact `-- q:<name>` registry marker.

    ``mapping`` is a dict {query_name: rows}. Unmapped (or unnamed) statements
    return an empty result — the same fall-through the substring fakes gave.
    """

    def __init__(self, mapping=None):  # noqa: ANN001
        self._mapping = dict(mapping or {})
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        sql = str(statement)
        self.executed.append(sql)
        name = query_name(statement)
        return _FakeResult(self._mapping.get(name, []))
