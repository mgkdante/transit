# Transit

## Language

**Feed family**:
One kind of live data from a provider, such as vehicle positions, trip updates or alerts.
_Avoid_: feed, tier, source

**Feed health**:
What a rider can trust about a feed family right now: never loaded, live, stale, retrying, or failed with no data. Unknown age counts as stale for a retained snapshot; a family that has never loaded is not stale.
_Avoid_: degraded, freshness
