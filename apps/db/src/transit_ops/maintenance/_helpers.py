"""Cross-tier maintenance helpers: rowcount/scalar-count coercion + the package logger.

Split from a single ``maintenance.py`` module (slice-9.1.1-zeta) into a per-tier
package mirroring the ε ``snapshots/builders/`` precedent — a pure mechanical
refactor, zero behavior change. ``_safe_rowcount`` and ``_safe_scalar_count`` are
called by every tier module, so they live in this shared leaf.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("transit_ops.maintenance")


def _safe_rowcount(result) -> int:  # noqa: ANN001
    rowcount = getattr(result, "rowcount", 0)
    return max(int(rowcount or 0), 0)


def _safe_scalar_count(result) -> int:  # noqa: ANN001
    if not hasattr(result, "scalar_one"):
        raise TypeError("Dry-run count result must provide scalar_one()")
    value = result.scalar_one()
    return max(int(value or 0), 0)
