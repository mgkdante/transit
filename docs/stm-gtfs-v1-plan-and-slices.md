# STM GTFS + GTFS-RT Portfolio Project — V1 Plan and Delivery Slices

Prepared: 2026-03-23  
Owner: Yesid  
Primary public project URL: `https://transit.yesid.dev`  
Suggested case-study URL: `https://transit.yesid.dev/projects/stm-ops-dashboard`  
Suggested docs URL: `https://transit.yesid.dev/docs/stm-gtfs-powerbi`  
Suggested status URL (optional later): `https://transit.yesid.dev/status/stm`

---

## 1) What this project is

A **provider-agnostic GTFS / GTFS-RT transit analytics pipeline** that starts with **STM** and produces an **operations-style Power BI dashboard** backed by **Neon Postgres**.

This is **not** a self-serve SaaS in V1.

The point of V1 is to prove:
- raw feed ingestion
- schedule + realtime normalization
- SQL-first reporting design
- analytics-ready modeling
- portfolio-quality delivery and documentation

The positioning is:

> Built a provider-ready GTFS / GTFS-RT analytics pipeline using STM feeds, normalized into Neon Postgres and surfaced through a Power BI operations dashboard.

---

## 2) Standards anchors for the implementation

The implementation should stay anchored to the official standards instead of STM-specific assumptions.

### GTFS foundation
- GTFS is an open standard with **two main parts**: **GTFS Schedule** and **GTFS Realtime**.
- GTFS Schedule is a **ZIP** containing mostly `.txt` files.
- At its most basic form, a GTFS Schedule dataset is composed of **7 core files**: `agency.txt`, `routes.txt`, `trips.txt`, `stops.txt`, `stop_times.txt`, `calendar.txt`, and `calendar_dates.txt`.
- The official source of truth for GTFS Schedule structure is the **GTFS Schedule Reference**.

### GTFS Realtime foundation
- GTFS Realtime supports three major information types: **TripUpdates**, **VehiclePositions**, and **Alerts**.
- V1 will use **TripUpdates** and **VehiclePositions** only.
- In GTFS Realtime, `FeedHeader.timestamp` is required and identifies when the feed content was created.
- `FeedHeader.feed_version` is optional and can match the `feed_info.feed_version` from the GTFS Schedule feed.

### Official implementation ecosystem
- The `google/transit` repository remains the central public GitHub home for GTFS resources and links.
- Official pre-generated GTFS Realtime language bindings are maintained by **MobilityData** in `gtfs-realtime-bindings`, including Python.

### STM-specific implementation constraints
- STM exposes GTFS static downloads and GTFS Realtime through its developer portal.
- STM applies a quota of **10 requests/second** and **10,000 requests/day** per developer.
- STM data usage is under **CC BY 4.0**, with attribution requirements.
- STM notes that métro schedules are indicative and should not be used to build an application on métro schedules.

**Practical consequence:** V1 should focus on **bus schedule + bus realtime**, while treating métro schedule data cautiously.

---

## 3) Product decision for V1

### Build this
- **STM-only implementation**
- **Provider-ready architecture**
- **One strong Power BI dashboard**
- **One strong case study on `transit.yesid.dev`**

### Do not build this in V1
- self-serve onboarding for arbitrary agencies
- auth / user accounts / tenant management
- support for non-GTFS transit APIs
- public multi-city product UX
- custom frontend map app as the main deliverable

This is a **portfolio system**, not a startup launch.

---

## 4) V1 success criteria

V1 is done when all of the following are true:

1. STM static GTFS can be downloaded and versioned.
2. STM GTFS-RT TripUpdates and VehiclePositions can be polled on a safe cadence and stored.
3. Raw data can be traced to ingestion runs.
4. Static and realtime data are normalized into canonical tables in Neon.
5. A Gold layer exists for dashboarding.
6. Power BI shows 2–4 polished pages and meaningful KPIs.
7. `transit.yesid.dev` has a project page with architecture, screenshots, and repo links.

---

## 5) Recommended V1 stack

### Core stack
- **Python 3.12**
- **Neon Postgres** for database and marts
- **Cloudflare R2** (or another S3-compatible bucket) for raw bronze objects
- **Power BI Desktop** for dashboard authoring

### Python libraries
- `httpx` for HTTP
- `gtfs-realtime-bindings` for protobuf parsing
- `pandas` or `polars` for schedule transforms
- `psycopg` for Postgres access
- `pydantic` for config models
- `sqlalchemy` + `alembic` if you want formal migrations in Python

### Tooling
- `uv` for dependency management
- `ruff` for linting / formatting
- `pytest` for tests
- `.env` for local configuration
- GitHub Actions for daily static ingestion and CI

### Runtime split
- **Static GTFS job**: GitHub Actions or scheduled container once per day
- **Realtime GTFS-RT job**: small always-on worker on Railway / Fly / Render

### Why this stack
- It stays centered on **SQL + pipeline design**, which is the real value of the project.
- It keeps Neon as the reporting core.
- It avoids fake complexity like Kafka, Airflow, or a full custom frontend before the dashboard exists.

---

## 6) Architecture principles

### Principle 1: GTFS-native core
The core model should reflect GTFS entities:
- provider
- dataset version
- agency
- route
- trip
- stop
- stop_time
- service date
- vehicle position
- trip update

### Principle 2: provider-agnostic within GTFS
Every major table should be able to support multiple providers later by carrying:
- `provider_id`
- `feed_version` or dataset version
- ingestion timestamps
- source identifiers

### Principle 3: raw first, then canonical
Do not parse directly into dashboard tables.

Use:
- **Bronze** = raw files / raw snapshots
- **Silver** = parsed canonical tables
- **Gold** = reporting marts and KPI-friendly views

### Principle 4: observability is part of the product
Track:
- ingestion status
- source URL
- fetch time
- feed timestamp
- entity count
- object storage path
- checksum
- row counts loaded

### Principle 5: visible output early
No endless framework setup.

You should get to a visible dashboard as fast as possible.

---

## 7) Recommended logical architecture

```text
STM GTFS static ZIP  --->  Bronze object storage  --->  Silver schedule tables  --->  Gold marts  --->  Power BI
STM GTFS-RT feeds    --->  Bronze raw snapshots  --->  Silver realtime tables --->  Gold marts  --->  Power BI
                                               \->  Ops tables / ingestion logs
```

Optional later:
- lightweight API for freshness/status
- docs site on `transit.yesid.dev`
- provider switcher once a second agency is added

---

## 8) Provider-ready abstractions from day 1

Do not over-engineer, but do create clean seams.

### Core config models

```text
ProviderConfig
- provider_id
- display_name
- timezone
- attribution_text
- website_url

StaticFeedConfig
- provider_id
- url
- format = gtfs_schedule_zip
- refresh_kind = scheduled
- refresh_interval_seconds

RealtimeFeedConfig
- provider_id
- feed_kind = trip_updates | vehicle_positions | alerts
- url
- auth_type
- refresh_interval_seconds
- enabled
```

### Core interfaces

```text
StaticFeedIngestor
- fetch()
- persist_raw()
- register_ingestion_run()

RealtimeFeedIngestor
- fetch()
- decode()
- persist_raw()
- normalize_entities()

ScheduleNormalizer
- load_zip()
- standardize_columns()
- upsert_schedule_tables()

RealtimeNormalizer
- normalize_trip_updates()
- normalize_vehicle_positions()
```

### Rule
The abstraction should target **GTFS / GTFS-RT**, not “any transit API.”

---

## 9) Data layers

## Bronze
Purpose:
- archive original files
- preserve reprocessing ability
- keep source-of-truth snapshots

Examples:
- `bronze/stm/static/YYYY/MM/DD/gtfs_stm.zip`
- `bronze/stm/realtime/trip_updates/YYYY/MM/DD/HH/mmss.pb`
- `bronze/stm/realtime/vehicle_positions/YYYY/MM/DD/HH/mmss.pb`

## Silver
Purpose:
- parse and normalize into canonical relational tables
- standardize time handling and keys
- join static + realtime entities where possible

## Gold
Purpose:
- expose dashboard-ready facts, dimensions, and summary views
- optimize for Power BI clarity, not raw ingestion fidelity

---

## 10) Neon schema design

Recommended schemas:
- `core`
- `raw`
- `silver`
- `gold`
- `ops`

### `core`
Stable metadata.

Suggested tables:
- `core.providers`
- `core.feed_endpoints`
- `core.dataset_versions`

### `raw`
Ingestion tracking.

Suggested tables:
- `raw.ingestion_runs`
- `raw.ingestion_objects`
- `raw.realtime_snapshot_index`

### `silver`
Canonical transit model.

Suggested tables:
- `silver.agencies`
- `silver.routes`
- `silver.trips`
- `silver.stops`
- `silver.stop_times`
- `silver.calendar`
- `silver.calendar_dates`
- `silver.shapes`
- `silver.frequencies`
- `silver.trip_updates`
- `silver.trip_update_stop_times`
- `silver.vehicle_positions`

### `gold`
Reporting model.

Suggested dimensions:
- `gold.dim_provider`
- `gold.dim_route`
- `gold.dim_stop`
- `gold.dim_trip`
- `gold.dim_date`
- `gold.dim_time`

Suggested facts:
- `gold.fact_vehicle_snapshot`
- `gold.fact_trip_delay_snapshot`
- `gold.fact_route_interval`
- `gold.fact_stop_interval`

### `ops`
Operational visibility.

Suggested tables/views:
- `ops.pipeline_health`
- `ops.latest_feed_status`
- `ops.load_audit`

---

## 11) Keys and modeling rules

### Key rules
- Use composite natural identity where needed: `provider_id + source_id`
- Keep source IDs from GTFS intact
- Add surrogate keys in Gold only if they simplify BI

### Time rules
- Store timestamps in UTC
- Also derive Montréal-local reporting columns where useful
- Keep both:
  - `ingested_at_utc`
  - `feed_timestamp_utc`
  - derived local date / hour fields for reporting

### Versioning rules
- Static GTFS datasets should have a recorded dataset version row.
- Realtime rows should carry the relevant feed timestamp and ingestion run ID.

### Deletion / replacement rules
- Static feed loads should behave like **replace-by-dataset-version**, not blind append forever.
- Realtime fact tables should append snapshots.

---

## 12) Polling strategy for STM

Because STM limits developers to **10,000 requests/day**, polling must be deliberate.

### V1 cadence
- `TripUpdates`: every **30 seconds**
- `VehiclePositions`: every **30 seconds**
- `Alerts`: not included in V1

This gives roughly:
- 2 requests/minute x 60 x 24 = **2,880 requests/day per endpoint**
- 2 endpoints = **5,760 requests/day**

That is comfortably below the stated daily quota.

### Static cadence
- Download static GTFS **daily**
- Optionally add a checksum guard so unchanged files are not reparsed unnecessarily

---

## 13) Initial KPIs for V1

Keep V1 small but serious.

### Network overview KPIs
- active vehicles
- routes currently active
- average delay
- delayed trips count
- on-time percentage
- latest feed freshness

### Route KPIs
- average delay by route
- worst routes in selected time window
- hourly average delay by route

### Stop KPIs
- busiest stops by observed traffic
- worst stops by average delay
- delay by stop and hour

### Operations KPIs
- last successful pull per feed
- feed age in minutes
- entity counts per snapshot

---

## 14) Power BI scope for V1

### Pages
1. **Network Overview**
2. **Route Performance**
3. **Stop Performance**
4. **Pipeline / Live Freshness**

### Modeling rules
- Use a clean star-like model
- Prefer **Import mode** for historical analysis
- Keep hot realtime views isolated if needed
- Create measures in a semantic layer, not directly in every visual

### Design goal
Make it look like an internal operations dashboard that a transit PMO or service operations team could actually use.

---

## 15) Public portfolio packaging on yesid.dev

V1 should have a clean public presentation, even if the dashboard itself is not fully public.

### Minimum public assets
- project overview page at `transit.yesid.dev`
- case study page at `transit.yesid.dev/projects/stm-ops-dashboard`
- architecture diagram image
- dashboard screenshots / GIFs
- stack summary
- KPI summary
- repo link
- short write-up of design decisions

### Suggested sections for the case study page
- Problem
- Data sources
- Standards used
- Architecture
- Modeling decisions
- Dashboard walkthrough
- Trade-offs
- Future provider expansion

### Important branding rule
Show off `yesid.dev`, but do not fake a product you did not build.

So use:
- **portfolio / case study / docs / status**

Do not pretend V1 is already a self-serve transit analytics platform.

---

## 16) Delivery slices

These slices are ordered to force shipping.

## Slice 0 — Repo bootstrap and project skeleton
**Goal:** create the minimum structure needed to move fast without chaos.

### Deliverables
- mono-repo or single repo initialized
- `README.md`
- Python environment via `uv`
- lint / format / test setup
- base `.env.example`
- initial docs folder

### Done when
- project installs locally in one command
- one CI run passes
- repo structure is stable enough to start coding

---

## Slice 1 — Provider registry and config abstraction
**Goal:** make the code provider-ready without building a fake platform.

### Deliverables
- `providers/stm.yaml` or equivalent config
- `ProviderConfig`, `StaticFeedConfig`, `RealtimeFeedConfig`
- environment handling for STM API key

### Done when
- changing provider settings does not require editing core ingestion logic
- STM config is the only active provider

---

## Slice 2 — Bronze static GTFS ingestion
**Goal:** fetch, archive, and register the static schedule feed.

### Deliverables
- static downloader job
- checksum logic
- raw object upload
- `raw.ingestion_runs` and `raw.ingestion_objects`

### Done when
- one STM static ZIP is fetched successfully
- the raw object path is recorded
- run status, byte size, checksum, and timestamps are stored

---

## Slice 3 — Bronze GTFS-RT snapshot capture
**Goal:** safely pull realtime data and preserve raw snapshots.

### Deliverables
- poller for `TripUpdates`
- poller for `VehiclePositions`
- raw protobuf object storage
- feed header metadata capture
- entity count logging

### Done when
- both realtime feeds are captured repeatedly
- each capture records feed timestamp, ingestion time, endpoint, and entity count
- the polling schedule stays inside STM quota

---

## Slice 4 — Silver static GTFS normalization
**Goal:** turn the static ZIP into canonical relational tables.

### Deliverables
- ZIP parser
- canonical load for routes, trips, stops, stop_times, calendar, calendar_dates
- optional load for shapes and frequencies if present
- dataset version registration

### Done when
- the core static tables are queryable in Neon
- rerunning a load creates a clean new dataset version
- route / trip / stop relationships are valid

---

## Slice 5 — Silver GTFS-RT normalization
**Goal:** turn realtime protobuf messages into canonical relational tables.

### Deliverables
- decode TripUpdates feed
- decode VehiclePositions feed
- normalized `silver.trip_updates`
- normalized `silver.trip_update_stop_times`
- normalized `silver.vehicle_positions`

### Done when
- realtime data can be joined back to static route / trip / stop entities where possible
- snapshot timestamping is correct
- null / optional fields do not break the pipeline

---

## Slice 6 — Gold marts and KPI views
**Goal:** create BI-ready models instead of making Power BI do all the work.

### Deliverables
- `gold.dim_route`
- `gold.dim_stop`
- `gold.dim_date`
- `gold.fact_vehicle_snapshot`
- `gold.fact_trip_delay_snapshot`
- at least 5 KPI views or metric queries

### Done when
- Power BI can connect without ugly ad hoc joins
- top KPIs can be reproduced directly from SQL
- metric definitions are documented

---

## Slice 7 — Power BI dashboard V1
**Goal:** deliver visible proof.

### Deliverables
- 2–4 polished pages
- DAX measures for core KPIs
- filters for route / date / direction
- freshness card or ops page

### Done when
- the dashboard looks portfolio-worthy
- the story is understandable without your narration
- screenshots are good enough for your portfolio page

---

## Slice 8 — Documentation and public case study
**Goal:** package the work like a consultant, not like a hobbyist.

### Deliverables
- architecture diagram
- data model diagram
- metric definitions
- runbook / setup guide
- case study page content for `yesid.dev`

### Done when
- someone can understand the system from docs alone
- the repo reads like client-deliverable work
- the portfolio page explains business value, not just tech

---

## 17) Suggested repo structure

```text
transit-ops/
  README.md
  pyproject.toml
  .env.example
  .github/
    workflows/
  docs/
    architecture.md
    metrics.md
    runbook.md
    images/
  config/
    providers/
      stm.yaml
  src/
    transit_ops/
      settings.py
      logging.py
      db/
        connection.py
        migrations/
      core/
        models.py
      ingestion/
        static/
          fetch.py
          archive.py
        realtime/
          trip_updates.py
          vehicle_positions.py
      normalization/
        schedule/
          parser.py
          loader.py
        realtime/
          trip_updates.py
          vehicle_positions.py
      marts/
        gold_views.sql
      sql/
        ddl/
        seeds/
  tests/
    test_config.py
    test_static_parse.py
    test_realtime_decode.py
  powerbi/
    stm-ops-dashboard.pbix
  portfolio/
    case-study.md
```

---

## 18) What to defer until V2

- provider switcher UI
- service alerts ingestion
- public live map
- PostGIS-heavy geospatial enrichment
- alerting / notifications
- public API layer
- onboarding wizard for new transit agencies
- multi-tenant auth

---

## 19) Immediate next steps

1. Lock the repo structure.  
2. Lock the Neon schema list.  
3. Create STM provider config.  
4. Implement Bronze static ingestion first.  
5. Implement Bronze realtime capture second.  
6. Get one Gold mart working before you overthink the rest.  
7. Ship dashboard screenshots before adding V2 ideas.

---

## 20) Final call

The disciplined version of this project is:

- **provider-ready** but **STM-only** in V1
- **GTFS-native** but not “any API” nonsense
- **SQL-first** with **Neon** as the reporting core
- **Power BI visible proof** as early as possible
- **yesid.dev packaging** for portfolio leverage

That is the version worth building.

---

## References used for this plan

- Official GTFS overview: https://gtfs.org/documentation/overview/
- Official GTFS Schedule reference: https://gtfs.org/schedule/reference/
- Official GTFS Realtime reference: https://gtfs.org/documentation/realtime/reference/
- GTFS spec repository: https://github.com/google/transit
- GTFS Realtime bindings: https://github.com/MobilityData/gtfs-realtime-bindings
- STM developers portal overview: https://www.stm.info/fr/a-propos/developpeurs
- STM available data description: https://www.stm.info/fr/a-propos/developpeurs/description-des-donnees-disponibles
- STM developer portal FAQ / quotas: https://www.stm.info/fr/a-propos/developpeurs/faq-nouveau-portail-developpeurs
- STM terms of use: https://www.stm.info/fr/a-propos/developpeurs/condition-dutilisation
