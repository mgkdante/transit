"""Shared pytest fixtures for the transit_ops test suite."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _deterministic_cli_rendering(monkeypatch: pytest.MonkeyPatch) -> None:
    """Render Typer/Rich CLI help + errors deterministically (plain, no panels).

    Two CI-vs-local differences break the plain-substring assertions in
    test_cli.py (and the CLI-invoking tests in test_db_connection /
    test_orchestration), both rooted in how Typer renders help through Rich:

    1. COLOR — GitHub runners force color via FORCE_COLOR, so help renders as
       ANSI-styled panels and the styling breaks substrings. NO_COLOR alone is
       insufficient (Rich lets FORCE_COLOR win), so FORCE_COLOR/PY_COLORS must be
       *removed*, not just countered.
    2. WIDTH — Rich's panel defaults to 80 columns when COLUMNS is unset, wrapping
       long help/usage text across lines so a contiguous substring isn't present.
       Pin COLUMNS wide in-process (a ci.yml job-level COLUMNS did not reach the
       test process) so nothing wraps.

    With both pinned here, CLI help renders plain and wide identically everywhere.
    """
    monkeypatch.delenv("FORCE_COLOR", raising=False)
    monkeypatch.delenv("PY_COLORS", raising=False)
    monkeypatch.setenv("NO_COLOR", "1")
    monkeypatch.setenv("COLUMNS", "200")
