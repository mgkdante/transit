
from __future__ import annotations

from transit_ops.sql_registry import query_name


def history_count_rows(statement, rows):
    """Represent count columns returned by historic SQL in in-memory query fixtures."""
    name = query_name(statement) or ""
    if not name.startswith(("history.network.", "history.lines.", "history.stops.")):
        return rows
    field = "route_id" if name.startswith("history.lines.") else "stop_id"
    if ".ids." in name:
        if any("__history_inventory_count" in row for row in rows):
            return rows
        return [dict(row, __history_inventory_count=len(rows)) for row in rows] or [
            {field: None, "__history_inventory_count": 0},
        ]
    if not rows or any("local_date" not in row for row in rows):
        return rows
    counts = {}
    for row in rows:
        key = (row.get(field, ""), str(row["local_date"])[:7])
        counts[key] = counts.get(key, 0) + 1
    return [dict(row, __history_scope_count=row.get(
        "__history_scope_count", counts[(row.get(field, ""), str(row["local_date"])[:7])],
    )) for row in rows]


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
        return _FakeResult(history_count_rows(statement, self._mapping.get(name, [])))
