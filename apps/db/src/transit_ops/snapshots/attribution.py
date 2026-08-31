"""Render provider attribution templates at snapshot generation time."""

from __future__ import annotations

from datetime import date

_LAST_UPDATE = "{last_update}"


def render_provider_attribution(text: str, generated_utc: str) -> str:
    if _LAST_UPDATE not in text:
        return text
    last_update = generated_utc.split("T", 1)[0]
    date.fromisoformat(last_update)
    return text.replace(_LAST_UPDATE, last_update)
