# Transit
A public dashboard that tells riders how reliable their transit service is, from live feeds and published history.

## Language

**Object digest**:
The checksum of the stored bytes of one object.
_Avoid_: content digest, ETag

**Dataset**:
One declared kind of kept record with one key, such as the captures of one feed or the rows of one table.
_Avoid_: edition (a schedule edition, which the code calls a dataset version)

**Archive grain**:
The kind of span a dataset is archived by: UTC day, service day, month or edition.
_Avoid_: grain (the reporting span: day, week, month)

**History ledger**:
The record of what is kept, in which form, and whether it was checked.
_Avoid_: archive (the stored copies themselves)

**Ledger event**:
One numbered, write-once record of a change to a window; it carries the window's next state.

**Window version**:
The number of ledger events applied to a window; a change is accepted only against the version it was decided on.

**Archive copy**:
The compressed, write-once form of one window of one dataset, in object storage under `archive/`.
_Avoid_: the alert archive (a published list of alerts)

**Hold**:
A mark on a window that stops trim from removing its working copy again, until a set time or with no end.

**Window key**:
The key of one window: `YYYY-MM-DD`, `YYYY-MM`, or a checksum for a schedule edition.
_Avoid_: window (the span identified by the key)

**Working copy**:
The form the pipeline writes and reads every day: rows on the server, and for captures one object per capture.
_Avoid_: archive copy (a version kept in history)

**Hot window**:
The age after which a verified window may have its working copy trimmed.
_Avoid_: deletion age (trim also requires a verified archive copy)

**Fold**:
A closed-period file or cell built from the windows of another dataset, such as a month file built from day cells.
_Avoid_: archive grain, reporting grain

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
For rankings, a window contains closed service days and has kind day, trailing_7, trailing_30, calendar_month or range; range names a visitor-picked kind.
_Avoid_: period, range

**League table**:
Lines or stops ordered by one measure over one closed window, with their figures and ranks.

**Shared rank**:
A rank shared by entries equal at the precision shown; their exact values still determine their order.

**Record**:
Published figures for completed days.

**Closed day**:
A provider-local day whose figures are final in the published record.
_Avoid_: finished UTC day, build day

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

**Live age**:
How old the live vehicle data on a page is: vehicle positions and the live metrics drawn from trip updates. It never includes service alerts, which carry their own age because they are checked less often.
_Avoid_: latest data, headline age, freshness

**Trip** (FR _trajet_):
One scheduled run of a vehicle along a line, from its first stop to its last.
_Avoid_: run, journey; in French, _voyage_

**Reported position**:
Where a vehicle said it was in its latest report.
_Avoid_: raw position, actual position

**Estimated position**:
Where a vehicle probably is now, projected along its route from its reported position and corrected when the next report arrives. Shown only when the rider asks for it.
_Avoid_: motion emulation, smooth mode, dead reckoning, interpolated position

**Live notice**:
The one message that tells a rider how far to trust the live data on a page, chosen from the feed health of the feed families that page shows: nothing to report, report behind, refresh unavailable, partial stall, whole-feed stall, unavailable, or no vehicles.
_Avoid_: banner, banner state, edge state, alert (alerts are service messages from the agency)

**Silent trip**:
A trip the schedule says should be running now that has no vehicle reporting for it.
_Avoid_: non-responding trip, ghost bus, missing vehicle

**Not reporting**:
A vehicle that has sent no report for 150 seconds or more, plus its provider's source lag (210 seconds for OC Transpo). It concerns one vehicle; a silent trip concerns a scheduled trip.
_Avoid_: silent vehicle, stale vehicle, offline

**Source lag**:
How much older than its publication time a provider's live data already is when Transit captures it, declared per provider (`live_source_lag_seconds`). It extends how long Estimated positions keep moving and when a vehicle counts as Not reporting.
_Avoid_: delay (delay is schedule adherence), latency

**Line without live data**:
A line its provider declares publishes no vehicle positions, such as the STM metro or the O-Train. Its trips are left out of the live silent trip count. If live data appears for it, the pipeline treats it as live and flags the outdated declaration.
_Avoid_: dead line, offline line

**Out-of-service vehicle**:
A vehicle that reports a position but is not assigned to any trip, usually parked or returning to the garage. It does not count toward coverage or the fleet in service.
_Avoid_: unknown vehicle, idle bus, ghost

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
