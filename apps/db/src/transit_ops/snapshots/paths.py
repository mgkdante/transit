"""Shared path validation for public snapshot graph edges and inventory keys."""

from __future__ import annotations

import re
from urllib.parse import unquote, urlsplit

_PERCENT_ESCAPE = re.compile(r"%([0-9a-fA-F]{2})")
_ENCODED_UNSAFE_BYTES = {ord(character) for character in "./\\?#:@"}


def safe_public_path(path: str) -> str:
    """Return a canonical relative snapshot path or reject encoded/control escapes."""

    canonical = path
    while True:
        if any(
            int(match.group(1), 16) in _ENCODED_UNSAFE_BYTES
            for match in _PERCENT_ESCAPE.finditer(canonical)
        ):
            raise ValueError("unsafe_public_path")
        decoded = unquote(canonical, errors="strict")
        if decoded == canonical:
            break
        canonical = decoded

    parsed = urlsplit(canonical)
    segments = canonical.split("/")
    if (
        not canonical
        or parsed.scheme
        or parsed.netloc
        or canonical.startswith("/")
        or "\\" in canonical
        or "%" in canonical
        or parsed.query
        or parsed.fragment
        or any(segment in {"", ".", ".."} for segment in segments)
        or any(
            character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F
            for character in canonical
        )
    ):
        raise ValueError("unsafe_public_path")
    return canonical


__all__ = ["safe_public_path"]
