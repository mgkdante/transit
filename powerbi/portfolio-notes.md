# Portfolio Notes

## What this dashboard proves

This dashboard proves that the repo is more than a feed collector.

It shows an end-to-end analytics system that:

- ingests official STM GTFS and GTFS-RT feeds
- preserves raw lineage in Cloudflare R2
- normalizes data into Silver tables in Neon Postgres
- rebuilds BI-ready Gold facts and dimensions
- supports an operations-style reporting layer in Power BI

## Why this is near-real-time and not streaming

The dashboard should be presented honestly as near-real-time operational
reporting, not as instant streaming telemetry.

What is proven today:

- static GTFS refresh runs daily at `06:00 UTC`
- that corresponds to `2:00 AM Eastern` while EDT is in effect
- realtime worker runs on Railway with a `30` second target cadence
- live freshness is one polling interval plus capture/load/build time

That means the dashboard is:

- fast enough for operational monitoring
- fully traceable back to raw lineage
- intentionally boring and reliable

It is not:

- push-streaming
- websocket-based
- second-by-second dispatch telemetry

## Operational questions the dashboard answers

- How many vehicles are active right now?
- How many routes are currently running?
- Which routes are carrying the most live vehicle activity?
- Which stops are seeing the most observed vehicle events?
- How fresh is the latest vehicle feed?
- How fresh is the latest trip-update feed?
- Is the current delay data complete enough to support delay KPIs?

## Business value it demonstrates

- operations visibility without building a custom frontend first
- standards-based design using GTFS and GTFS-Realtime instead of a custom API
- clean Bronze / Silver / Gold modeling for BI consumption
- a realistic consultant-style delivery story:
  data engineering, SQL modeling, KPI design, and dashboard planning

## V1 messaging for the case study

Use language like:

"Built a near-real-time STM transit operations analytics pipeline using official
GTFS and GTFS-Realtime feeds, normalized in Neon Postgres and prepared for a
Power BI operations dashboard."

## Important honesty notes

- Bronze writes remain R2-backed
- static and realtime automation are proven
- hosted Railway worker is proven
- Gold refresh is proven
- Power BI dashboard authoring is specified and mapped, but no `.pbix` file is
  checked into this repo yet
- delay visuals must be caveated when STM omits trip-level delay values in the
  latest snapshot
