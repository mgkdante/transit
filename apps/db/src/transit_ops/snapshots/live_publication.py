"""Live file dependencies and reuse of the last completed publication."""

# Vehicles include trip-derived status and delay. Network combines both families.
# Every file also depends on the static schedule; health reads capture/job state
# and the prior completed publication, so it is rebuilt on every publish attempt.
FILES: dict[str, tuple[str, set[str]]] = {
    "live/vehicles.json": ("build_vehicles", {"vehicle_positions", "trip_updates"}),
    "live/trips.json": ("build_trips", {"trip_updates"}),
    "live/alerts.json": ("build_alerts", {"i3_alerts"}),
    "live/network.json": ("build_network", {"vehicle_positions", "trip_updates"}),
    "live/stop_departures.json": ("build_stop_departures", {"trip_updates"}),
    "status/data_health.json": ("build_data_health", set()),
}


def select(prior: object, captures: dict[str, str | None]) -> tuple[list[str], dict[str, str]]:
    """Missing/legacy state rebuilds everything; failed uploads never advance state."""
    live = prior.get("files", {}).get("live", {}) if isinstance(prior, dict) else {}
    generations = live.get("generations", {})
    previous = live.get("input_captures", {})
    changed = {key for key, value in captures.items() if previous.get(key) != value}
    keys = [
        key
        for key, (_builder, inputs) in FILES.items()
        if key not in generations
        or key == "status/data_health.json"
        or "static_schedule" in changed
        or inputs & changed
    ]
    return keys, generations
