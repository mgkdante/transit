"""Shared pytest fixtures for the transit_ops test suite."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _deterministic_cli_rendering(monkeypatch: pytest.MonkeyPatch) -> None:
    """Render Typer/Rich CLI help + errors deterministically (plain, no panels).

    CI runners (GitHub Actions) force color via FORCE_COLOR. That makes Typer
    render help/usage through Rich as styled panels with box-drawing, which wraps
    and styles option text so the plain-substring assertions in test_cli.py fail
    in CI while passing locally (where color is not forced). Neutralize the
    color-forcing env so rendering is plain and identical everywhere.

    NO_COLOR alone is insufficient — Rich lets FORCE_COLOR win — so FORCE_COLOR
    (and PY_COLORS) must be *removed*, not just countered.
    """
    monkeypatch.delenv("FORCE_COLOR", raising=False)
    monkeypatch.delenv("PY_COLORS", raising=False)
    monkeypatch.setenv("NO_COLOR", "1")
    monkeypatch.setenv("TERM", "dumb")
