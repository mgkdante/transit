from __future__ import annotations

import logging


def configure_logging(log_level: str) -> None:
    """Configure a simple process-wide logging format."""

    level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
