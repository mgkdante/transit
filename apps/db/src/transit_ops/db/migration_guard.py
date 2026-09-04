"""Migration target intent guard."""

from __future__ import annotations

from collections.abc import Mapping

from transit_ops.db.target_safety import assert_explicit_remote_url as _assert_target_intent


def assert_explicit_remote_url(url: str, environ: Mapping[str, str]) -> None:
    """Enforce explicit process intent for a selected remote migration target."""

    _assert_target_intent(url, environ)
