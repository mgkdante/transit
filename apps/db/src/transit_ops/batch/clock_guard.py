import duckdb

from transit_ops.batch.engine import BatchEngineError

_CLOCK_NAMES = frozenset(
    """now today current_date current_time current_timestamp
current_localtimestamp localtime localtimestamp get_current_time get_current_timestamp
transaction_timestamp""".split()
)


class ClockReadRefused(BatchEngineError):
    pass


def refuse_clock_reads(sql: str) -> None:
    tokens = duckdb.tokenize(sql)
    for index, (start, kind) in enumerate(tokens):
        end = tokens[index + 1][0] if index + 1 < len(tokens) else len(sql)
        name = sql[start:end].strip().strip('"').lower()
        if kind == duckdb.token_type.identifier and name in _CLOCK_NAMES:
            raise ClockReadRefused(f"batch clock read refused: {name}")
