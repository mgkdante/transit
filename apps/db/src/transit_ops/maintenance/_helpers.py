"""Shared transaction and result contracts for maintenance tiers."""

from __future__ import annotations

import logging

from sqlalchemy.engine import Connection

logger = logging.getLogger("transit_ops.maintenance")


def _safe_rowcount(result: object) -> int:
    rowcount = getattr(result, "rowcount", 0)
    return max(int(rowcount or 0), 0)


def _safe_scalar_count(result: object) -> int:
    if not hasattr(result, "scalar_one"):
        raise TypeError("Dry-run count result must provide scalar_one()")
    value = result.scalar_one()
    return max(int(value or 0), 0)


def require_prune_transaction(connection: Connection) -> None:
    if (
        not connection.in_transaction()
        or connection.get_isolation_level() != "READ COMMITTED"
        or getattr(connection.connection.dbapi_connection, "autocommit", True)
    ):
        raise ValueError("Pruning requires a non-autocommit READ COMMITTED transaction")
