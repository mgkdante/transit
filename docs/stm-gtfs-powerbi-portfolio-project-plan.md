# STM GTFS + GTFS-RT Power BI Portfolio Project Plan

## Why this is a good portfolio project
This project is worth building because it shows the full chain:
- ingesting real external data
- handling both batch and near-real-time feeds
- modeling data for analytics
- defining business-style KPIs
- delivering a usable Power BI dashboard

The point is not “I like trains.”
The point is:

**I can build an operational reporting system from raw source data to dashboard.**

## Portfolio positioning
Frame the project like this:

**Built a near-real-time transit operations analytics pipeline using official STM GTFS and GTFS-realtime feeds, with a Power BI dashboard for service visibility, route performance, and delay monitoring.**

## Project goal
Build an end-to-end data pipeline that:
- consumes STM GTFS static data
- consumes STM GTFS-realtime data
- stores raw and curated layers
- models analytics-ready tables
- powers a Power BI dashboard

## Source data
### GTFS static
Use the STM GTFS schedule feed for:
- routes
- trips
- stops
- stop_times
- calendar / service dates

### GTFS-realtime
Use GTFS-RT feeds for:
- vehicle positions
- trip updates
- optionally service alerts later

## Recommended architecture
### Bronze layer
Raw ingestion layer.
- Download STM GTFS ZIP daily
- Capture GTFS-RT protobuf snapshots every 30–60 seconds
- Log ingestion metadata:
  - source URL
  - ingest timestamp
  - feed timestamp
  - entity count
  - status
  - object key / file path

### Silver layer
Parsed and cleaned layer.
- Parse GTFS static into structured tables
- Decode GTFS-RT protobuf into structured records
- Standardize keys and timestamps
- Align route_id, trip_id, stop_id, direction, service date where possible

Suggested silver tables:
- silver.routes
- silver.trips
- silver.stops
- silver.stop_times
- silver.calendar
- silver.vehicle_positions
- silver.trip_updates
- silver.ingestion_log

### Gold layer
Analytics-ready layer for Power BI.

Suggested dimensions:
- dim_route
- dim_stop
- dim_date
- dim_time

Suggested facts:
- fact_vehicle_snapshot
- fact_trip_delay_snapshot
- fact_stop_performance
- fact_route_hourly_performance

## Power BI model approach
Keep the model clean and client-looking.
- Use a star-schema style model
- Keep historical / analytical data in import mode
- Keep current / hot realtime data separate if needed
- Build KPI measures in a semantic layer, not ad hoc in visuals

## Core KPIs
### Network overview
- active vehicles
- routes currently running
- average delay
- on-time percentage
- delayed trips count
- worst route right now

### Route performance
- average delay by route
- delay by direction
- on-time percentage by route
- worst trips in selected window
- hourly trend by route

### Stop / station performance
- worst stops by average delay
- busiest stops
- delay by stop and hour
- reliability by time of day

### Live operations
- latest vehicle positions
- currently delayed trips
- current service health summary

## Dashboard pages
### Page 1 - Network Overview
Show:
- KPI cards
- average delay trend
- on-time percentage trend
- top delayed routes
- filter panel for date / route / mode

### Page 2 - Route Performance
Show:
- route ranking table
- delay distribution
- direction comparison
- hourly trend chart
- trip detail drilldown

### Page 3 - Stop / Station Performance
Show:
- stop ranking table
- busiest stops
- delay heatmap by hour
- map of stops / stations

### Page 4 - Live Operations
Show:
- current vehicle positions
- active delayed trips
- route status summary
- latest feed timestamp / pipeline freshness

## What makes the project strong on Upwork
This is not just a dashboard.
It demonstrates:
- SQL and data modeling
- pipeline design
- realtime ingestion thinking
- reporting architecture
- KPI definition
- dashboard delivery

That makes it relevant to:
- internal operations dashboards
- KPI reporting systems
- reporting layers
- data integrity and operational visibility work

## Scope the build in versions
### V1
- static GTFS ingestion
- GTFS-RT snapshot capture
- basic cleaned tables
- 1 Power BI dashboard with 2–3 pages
- 6–10 KPIs

### V2
- historical delay metrics
- route and stop drilldowns
- improved dimensional model
- better visuals and documentation

### V3
- alerts feed
- richer maps
- anomaly / reliability analysis
- exportable case study package

## Final portfolio deliverables
To make this useful for your Upwork portfolio, produce:
- architecture diagram
- repo with clean structure
- sample schemas / DDL
- ingestion explanation
- data model explanation
- dashboard screenshots
- short case study write-up
- 3–5 business insights from the dashboard

## How this should be described in your portfolio
Use language like:
- Designed a Bronze / Silver / Gold transit analytics pipeline
- Ingested official GTFS and GTFS-RT feeds from STM
- Modeled analytics-ready fact and dimension tables for Power BI
- Built a dashboard for route performance, delay tracking, and live operations visibility
- Balanced historical reporting with near-real-time operational data

## Rule for execution
Do not overbuild before you have something visible.

Build:
1. ingestion
2. clean tables
3. one presentable dashboard
4. case study packaging

That is the project.
