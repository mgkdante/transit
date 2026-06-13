"""Shared pytest fixtures for the transit_ops test suite."""

from __future__ import annotations

import pytest
import typer.rich_utils as _rich_utils


@pytest.fixture(autouse=True)
def _deterministic_cli_rendering(monkeypatch: pytest.MonkeyPatch) -> None:
    """Render Typer/Rich CLI help + usage deterministically (plain, wide).

    Typer freezes its help-console settings from env vars at IMPORT time
    (``typer.rich_utils``): ``FORCE_TERMINAL`` is True whenever ``GITHUB_ACTIONS`` /
    ``FORCE_COLOR`` / ``PY_COLORS`` is set, ``COLOR_SYSTEM`` defaults to ``"auto"``,
    and width comes from ``TERMINAL_WIDTH`` (not ``COLUMNS``). On GitHub runners
    ``GITHUB_ACTIONS`` is always set, so help renders as ANSI-styled Rich panels
    wrapped at 80 columns — which breaks the plain-substring assertions in
    test_cli.py (and the CLI-invoking tests in test_db_connection /
    test_orchestration) that pass locally where color is off and the terminal is
    wide.

    Because those settings are frozen at import, no runtime *env* change can fix
    them. Override the module constants directly — ``_get_rich_console()`` reads
    these globals at render time, so plain + wide rendering is guaranteed
    everywhere regardless of the ambient/CI environment.
    """
    monkeypatch.setattr(_rich_utils, "COLOR_SYSTEM", None, raising=False)
    monkeypatch.setattr(_rich_utils, "FORCE_TERMINAL", False, raising=False)
    monkeypatch.setattr(_rich_utils, "MAX_WIDTH", 200, raising=False)
