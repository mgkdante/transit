"""Endpoint cadence and optional UTC epoch phase for realtime workers."""

from datetime import datetime
from math import gcd

from transit_ops.core.models import FeedKind, ProviderManifest

CAPTURE_CADENCE_TOLERANCE_SECONDS = 2.0


def endpoint_due(feed, now: datetime, previous: datetime | None) -> bool:
    interval = int(feed.refresh_interval_seconds)
    if previous is not None:
        elapsed = (now - previous).total_seconds()
        if elapsed < max(0, interval - CAPTURE_CADENCE_TOLERANCE_SECONDS):
            return False
    phase = getattr(feed, "refresh_phase_seconds", None)
    if phase is None:
        return True
    # A missed phase waits for the next one rather than settling on a late cadence.
    if (now.timestamp() - phase) % interval > CAPTURE_CADENCE_TOLERANCE_SECONDS:
        return False
    slot = (now.timestamp() - phase) // interval
    if previous is None:
        return True
    return slot > (previous.timestamp() - phase) // interval


def worker_tick_seconds(manifest: ProviderManifest, poll_seconds: int) -> int:
    tick = poll_seconds
    for feed in manifest.feeds.values():
        if not feed.is_enabled or feed.feed_kind in (FeedKind.STATIC_SCHEDULE, FeedKind.GIS_STATIC):
            continue
        tick = gcd(tick, int(feed.refresh_interval_seconds))
        phase = getattr(feed, "refresh_phase_seconds", None)
        if phase is not None:
            tick = gcd(tick, phase)
    return tick


def aligned_sleep_seconds(now: datetime, tick: int) -> float:
    return tick - now.timestamp() % tick
