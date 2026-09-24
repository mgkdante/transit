# Stop detail

Static stop facts and the timetable sample share a keyed, optionally seeded resource. The timetable contains sampled times from a representative weekday; it cannot establish today’s service window or explain an empty live board. Keep the published sample cap separate from any frontend overflow count.

Departures and alerts use separate existing `createLiveStore` instances, so each report owns its timestamp, retained failures and shared TTL/clock policy. They poll across tabs, pause hidden/offline, refresh on resume/global refresh, and stop on unmount. No network-wide silent-trip inference belongs on the stop board. Its payload contains up to two predictions per route; missing delay stays unclassified. Direct stop-ID alerts remain visible without optional static code/route associations.

Static and current historic reports reload through their keys/manual/global epoch; retained-history discovery and ranges stay with `createStopHistoryResource`. Show source-specific timestamps and retained-refresh warnings. Overview metrics share one period or dated daily row; only that row supplies an observation date. Keep report generation separate from observation dates and retained-range selection.

Report stamps belong in content, outside disclosure headers. Keep their tokens intact and use the shared touch-target minimum for filter chips. Preserve localized tab/history URLs, map/back links, keyboard controls, tri-state accessibility, shared schedule tables, metrics and chart owners. Run `bun run test src/lib/features/stops`; browser checks cover independent failure/age/recovery, empty reports, both locales, narrow screens and touch/keyboard controls.
