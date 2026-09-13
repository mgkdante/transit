# Trip detail

The trip report lists predictions for up to one hour when it is prepared, not every remaining stop or a proven terminal. Count prediction rows and label the last reported stop. An absent trip is absent from that report; its ID may have expired or no data may have been reported. The optional stop index falls back to IDs.

`createLiveStore` polls only trips at the mounted manifest’s live TTL, uses the shared server clock and its 3×TTL stale policy, retains the last report on failure, and refreshes on the global refresh epoch. It pauses polling while hidden/offline and refreshes once when active again; unmount stops it. Label the report timestamp, keep stale/failed reports visible with a warning, and preserve the timestamp when a trip is absent. `ResourceBoundary` owns cold loading/error/retry; optional names do not determine report freshness.

Suppress summary delay only for published `on_time` with exact zero. Nonzero, null/omitted delay and unknown/conflicting status stay separate. Shared thresholds, rounding and colors belong to `site/delayPresentation`.

Keep mobile stop names above metadata, ETA text together, and localized map/line/stop links. Run `bun run test src/lib/features/trips` from `apps/web`; browser checks cover both locales, report windows, polling, retained failures, recovery and links.
