"""Whole-transaction retries for cooperating Gold writers."""

from collections.abc import Callable

from sqlalchemy import Connection, Engine
from sqlalchemy.exc import DBAPIError


def run_gold_transaction[Result](
    engine: Engine, operation: Callable[[Connection], Result]
) -> Result:
    for attempt in range(3):
        try:
            with engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn:
                with conn.begin():
                    return operation(conn)
        except DBAPIError as exc:
            if getattr(exc.orig, "sqlstate", None) not in {"40001", "40P01"} or attempt == 2:
                raise
    raise AssertionError("Transaction attempts exhausted")
