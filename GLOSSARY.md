# Transit
A public dashboard that tells riders how reliable their transit service is, from live feeds and published history.

## Language

**Verdict**:
The one-word answer to "how reliable is this line, stop or network over this window": reliable, patchy, unreliable, tentative or absent.
_Avoid_: status, badge, OTP status

**Tentative**:
A verdict given when there are too few observations (under 30) or the uncertainty leaves open whether the service is reliable. Shown with a hedge.
_Avoid_: too few, low confidence

**Hedge**:
The sentence that tells the reader how much to trust a number.
_Avoid_: caveat, disclaimer

**Problem line**:
A line whose verdict is patchy or unreliable.
_Avoid_: late line, severe line

**Grain**:
The size of a reporting span: day, week or month.
_Avoid_: mode, resolution

**Window**:
One specific span at a grain, such as the week of 27 October.
_Avoid_: period, range

**Feed family**:
One kind of live data from a provider, such as vehicle positions, trip updates or alerts.
_Avoid_: feed, tier, source

**Feed health**:
What a rider can trust about a feed family right now: never loaded, live, stale, retrying, or failed with no data. Unknown age counts as stale for a retained snapshot; a family that has never loaded is not stale.
_Avoid_: degraded, freshness
