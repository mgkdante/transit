from __future__ import annotations

from transit_ops.gold.reader.histogram import SqlNumber, round_half_away

# MIN_N_RATE controls display confidence; emit raw counts, rates and Wilson bounds below it.
MIN_N_RATE = 30
WILSON_Z = 1.96


def otp_pct(on_time: SqlNumber | None, known: SqlNumber | None) -> int | None:
    if on_time is None or not known:
        return None
    known_obs = float(known)
    if known_obs <= 0:
        return None
    return int(round_half_away(100.0 * float(on_time) / known_obs, 0))


def otp_pct_severe_proxy(
    observation_count: SqlNumber | None, severe: SqlNumber | None
) -> int | None:
    """Stop OTP proxy: per-stop delay observations not severe over observations."""
    if not observation_count:
        return None
    obs = float(observation_count)
    if obs <= 0:
        return None
    return int(round_half_away(100.0 * (obs - float(severe or 0)) / obs, 0))


def wilson_bounds(
    successes: SqlNumber | None, n: SqlNumber | None, *, z: float = WILSON_Z
) -> tuple[float, float] | None:
    if successes is None or not n:
        return None
    total = float(n)
    if total <= 0:
        return None
    k = min(max(float(successes), 0.0), total)
    p = k / total
    z2 = z * z
    denom = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denom
    margin = z * ((p * (1.0 - p) / total + z2 / (4.0 * total * total)) ** 0.5) / denom
    lo = max(0.0, (center - margin) * 100.0)
    hi = min(100.0, (center + margin) * 100.0)
    return (float(round_half_away(lo, 1)), float(round_half_away(hi, 1)))


def wilson_lo(
    successes: SqlNumber | None, n: SqlNumber | None, *, z: float = WILSON_Z
) -> float | None:
    b = wilson_bounds(successes, n, z=z)
    return None if b is None else b[0]


def wilson_hi(
    successes: SqlNumber | None, n: SqlNumber | None, *, z: float = WILSON_Z
) -> float | None:
    b = wilson_bounds(successes, n, z=z)
    return None if b is None else b[1]


def avg_delay_min(avg_delay_seconds: SqlNumber | None) -> float | None:
    if avg_delay_seconds is None:
        return None
    return float(round_half_away(float(avg_delay_seconds) / 60.0, 1))


def severe_pct(observation_count: SqlNumber | None, severe: SqlNumber | None) -> float | None:
    if not observation_count:
        return None
    obs = float(observation_count)
    if obs <= 0:
        return None
    return float(round_half_away(100.0 * float(severe or 0) / obs, 1))
