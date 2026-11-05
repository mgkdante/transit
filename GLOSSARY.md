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
What a rider can trust about a feed family right now: never loaded, live, stale, retrying, or failed with no data. Unknown age counts as stale for a retained snapshot; a family that has never loaded is not stale. Retrying means another attempt after a failure, even when retained data has an unknown age.
_Avoid_: degraded, freshness

**Publication age**:
How old a published report is. A newly prepared report can still contain old agency data.
_Avoid_: feed age, capture age

**Serving capture age**:
How old the feed capture accepted into the report's serving data is. A newer download that could not be processed does not make that data current.
_Avoid_: latest download age, publication age

**Partial stall**:
One active feed family is stale while another is current or has not loaded yet. It cannot establish that the whole feed has stopped responding.
_Avoid_: outage, whole-feed stall

**Published uncertainty range**:
The lower and upper percentage bounds supplied with a reliability reading. They express uncertainty in that reading and do not supply a missing exact on-time count.
_Avoid_: reconstructed count, guaranteed range

**Live-eligible KPI sample**:
A valid current KPI reading with the delay, coverage, route total and at least one route delay needed for the live summary. A valid but incomplete reading is a demo sample; an invalid response is a failure.
_Avoid_: healthy feed, live guarantee

**Demo sample**:
A valid KPI response that cannot supply the live summary, including an expected cold response. It does not establish a service failure; the consumer decides when to display demo values after holding a previous reading.
_Avoid_: outage, invalid response
