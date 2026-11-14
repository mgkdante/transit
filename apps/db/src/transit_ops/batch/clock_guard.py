from collections.abc import Iterator
from functools import cache

import duckdb

from transit_ops.batch.engine import BatchEngineError

# Include keyword forms and clock overloads marked CONSISTENT by the catalog.
_CLOCK_NAMES = frozenset(
    """current_date current_time current_timestamp localtime localtimestamp
current_localtime current_localtimestamp age clock_timestamp statement_timestamp""".split()
)
# Configuration is locked; error only raises a caller-supplied message.
_CONTEXT = {"current_setting", "error"}
_READERS = frozenset(
    """range generate_series unnest read_parquet parquet_scan read_csv read_csv_auto
read_json read_json_auto json_each json_tree repeat repeat_row""".split()
)


class ClockReadRefused(BatchEngineError):
    pass


def _identifiers(sql: str) -> Iterator[str]:
    data = sql.encode("utf-8")
    tokens = duckdb.tokenize(sql)
    for index, (start, kind) in enumerate(tokens):
        end = tokens[index + 1][0] if index + 1 < len(tokens) else len(data)
        if kind == duckdb.token_type.identifier:
            yield data[start:end].decode("utf-8").strip().strip('"').lower()


@cache
def _refused_names() -> frozenset[str]:
    with duckdb.connect(
        config={
            "threads": "1",
            "autoload_known_extensions": "false",
            "autoinstall_known_extensions": "false",
        }
    ) as conn:
        rows = conn.execute("""SELECT function_name, function_type, stability, macro_definition
            FROM duckdb_functions()""").fetchall()
    names = set(_CLOCK_NAMES)
    names.update(
        name
        for name, kind, stability, _ in rows
        if (stability and stability != "CONSISTENT" and name not in _CONTEXT)
        or (kind == "table" and name not in _READERS)
    )
    while True:
        expanded = names | {
            name for name, _, _, body in rows if body and set(_identifiers(body)) & names
        }
        if expanded == names:
            return frozenset(names)
        names = expanded


def refuse_clock_reads(sql: str) -> None:
    for name in _identifiers(sql):
        if name in _refused_names():
            raise ClockReadRefused(f"batch clock or dynamic execution refused: {name}")
