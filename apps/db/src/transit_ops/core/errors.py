from __future__ import annotations


class OptionalSourceUnavailable(RuntimeError):
    """Raised by optional source operations when no source is available.

    Optional feeds (GIS shapefiles, service alerts) are not published by every
    provider. When an optional feed is absent or unreachable, capture raises this
    so callers can skip the unavailable operation. Lives in ``core`` so ingestion
    and orchestration can share it without an import cycle.
    """
