from __future__ import annotations


class OptionalSourceUnavailable(RuntimeError):
    """Raised by optional source operations when no source is available.

    Optional feeds (GIS shapefiles, service alerts) are not published by every
    provider. When an optional feed is absent or unreachable, capture raises this
    so the source-factory runner records a clean SKIPPED step instead of failing
    the rebuild. Lives in ``core`` so both ``ingestion`` and ``source_factory``
    can raise/catch it without an import cycle.
    """
