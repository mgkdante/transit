"""Rate + confidence kernel — the single owner of the published proportion math.

Moved from snapshots/builders/_helpers.py (which re-exports for its callers)
so gold rollups and snapshot builders share ONE definition. All rounding here
is half-away-from-zero (matching Postgres ROUND; 2026-07-01 rebaseline — see
the provenance methodology `rounding` note). Honest-NULL throughout: a missing
numerator or empty denominator returns None, never a fabricated rate.
"""

from __future__ import annotations

from transit_ops.gold.reader.histogram import round_half_away

# --- Chart Doctrine honesty spine (slice-S3) ---------------------------------
# The single server-authoritative definitions of "reliable enough" and the
# confidence channel. MIN_N_RATE is DISPLAY-ONLY: the builders always emit the
# raw observation_count + honest rate + Wilson bounds and NEVER null a rate below
# it (so the web keeps the n it needs for data-depth gating, and the threshold
# stays tunable without a republish). Surfaced in Provenance.methodology so the
# web reads ONE value. See the Transit Chart Doctrine, section 4.0 (Constants
# Registry). The pre-existing metric-specific floors (headway COV n>=2, repeat-
# offender recurrence_days>=3) are unrelated and stay as-is.
MIN_N_RATE = 30  # proportion reliability floor (OTP / cancellation / silent / on-time-band)
WILSON_Z = 1.96  # 95% two-sided Wilson score interval


def otp_pct(on_time: object, known: object) -> int | None:
    """round(100 * on_time / known) as int; None when numerator or denominator is unknown."""
    if on_time is None or not known:
        return None
    known_obs = float(known)  # type: ignore[arg-type]
    if known_obs <= 0:
        return None
    return int(round_half_away(100.0 * float(on_time) / known_obs, 0))


def otp_pct_severe_proxy(observation_count: object, severe: object) -> int | None:
    """Stop OTP proxy: per-stop delay observations not severe over observations."""
    if not observation_count:
        return None
    obs = float(observation_count)  # type: ignore[arg-type]
    if obs <= 0:
        return None
    return int(round_half_away(100.0 * (obs - float(severe or 0)) / obs, 0))


def wilson_bounds(
    successes: object, n: object, *, z: float = WILSON_Z
) -> tuple[float, float] | None:
    """95% Wilson score interval (lo, hi) in PERCENT (0..100) for successes/n.

    The Chart Doctrine honesty channel for proportions: ranking on the LOWER
    bound stops a tiny-n fluke (1-of-1 = 100%) from out-ranking a high-volume
    bad actor. Pure Python, no scipy. Returns None when the numerator is unknown
    or the denominator is falsy/<=0 — mirrors the otp_pct honest-NULL guard so a
    missing rate never gets a fabricated band. successes is clamped into [0, n].
    """
    if successes is None or not n:
        return None
    total = float(n)  # type: ignore[arg-type]
    if total <= 0:
        return None
    k = min(max(float(successes), 0.0), total)  # type: ignore[arg-type]
    p = k / total
    z2 = z * z
    denom = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denom
    margin = z * ((p * (1.0 - p) / total + z2 / (4.0 * total * total)) ** 0.5) / denom
    lo = max(0.0, (center - margin) * 100.0)
    hi = min(100.0, (center + margin) * 100.0)
    return (float(round_half_away(lo, 1)), float(round_half_away(hi, 1)))


def wilson_lo(successes: object, n: object, *, z: float = WILSON_Z) -> float | None:
    b = wilson_bounds(successes, n, z=z)
    return None if b is None else b[0]


def wilson_hi(successes: object, n: object, *, z: float = WILSON_Z) -> float | None:
    b = wilson_bounds(successes, n, z=z)
    return None if b is None else b[1]


def avg_delay_min(avg_delay_seconds: object) -> float | None:
    if avg_delay_seconds is None:
        return None
    return float(round_half_away(float(avg_delay_seconds) / 60.0, 1))  # type: ignore[arg-type]


def severe_pct(observation_count: object, severe: object) -> float | None:
    if not observation_count:
        return None
    obs = float(observation_count)  # type: ignore[arg-type]
    if obs <= 0:
        return None
    return float(round_half_away(100.0 * float(severe or 0) / obs, 1))
