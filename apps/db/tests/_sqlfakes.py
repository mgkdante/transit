
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
        return iter(self._rows)

    def fetchone(self):  # noqa: ANN201
        return self._rows[0] if self._rows else None

    def scalar_one(self):  # noqa: ANN201
        return self._rows[0] if self._rows else 0


class NamedQueryConn:

    def __init__(self, mapping=None, *, strict: bool = False):  # noqa: ANN001
        self._mapping = dict(mapping or {})
        self._strict = strict
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ARG002
        sql = str(statement)
        self.executed.append(sql)
        name = query_name(statement)
        if self._strict and name not in self._mapping:
            raise AssertionError(f"unmapped query: {name!r}")
        return _FakeResult(self._mapping.get(name, []))
