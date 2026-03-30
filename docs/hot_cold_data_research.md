# Sustainable Near‑Real‑Time GTFS‑RT Analytics on R2 + Neon + Railway + Power BI

## Overview and constraints

Your current architecture already matches a “consultant‑grade” medallion pattern: static GTFS and GTFS‑RT snapshots land in Bronze object storage, are normalized into Silver relational tables, and are shaped into Gold marts and KPI views for dashboard consumption. fileciteturn3file1L1-L1

The system is explicitly positioned as **near‑real‑time operational reporting**, not true streaming (push/WebSockets). That framing is consistent with GTFS‑RT’s consumer model: each feed message is obtained via an HTTP GET response, not a push channel. citeturn5search4 fileciteturn3file2L1-L1

Key current design choices (already in your repo docs) that matter for sustainability:

- Bronze object storage keys are deterministic and provider/endpoint/time scoped, making lifecycle/retention straightforward. fileciteturn3file1L1-L1  
- Gold is split into a heavy rebuild path vs. a lightweight realtime refresh path, and the realtime worker uses the lightweight path so dashboard queries don’t depend on scanning or rebuilding full history each cycle. fileciteturn3file1L1-L1  
- You already lean toward bounded storage by default: “static Silver keeps only the current dataset version” and “realtime Silver keeps only the newest two days” (as documented). fileciteturn3file1L1-L1  

Named components (for cost/ops discussion): entity["organization","Société de transport de Montréal (STM)","montreal transit agency"] as the feed source; entity["company","Cloudflare","internet infrastructure firm"] R2 for Bronze; entity["company","Neon","serverless postgres platform"] Postgres for Silver/Gold; entity["company","Railway","app hosting platform"] for the realtime worker; and entity["company","Microsoft","software company"] as the publisher of the Power BI platform and guidance you’ll rely on. fileciteturn3file1L1-L1

## Cadence, freshness, and what actually breaks first

### GTFS‑RT best practice and STM quota reality

Two external constraints strongly support your desire to move from 300 seconds to faster polling:

- GTFS‑RT best practices recommend feeds be refreshed **at least once every 30 seconds** (or whenever the underlying info changes more frequently), and also recommend vehicle/trip update data not be older than **90 seconds**. citeturn5search5  
- STM’s developer portal states **10 requests/second** and **10,000 requests/day** per developer (global across apps in the same account/org). citeturn5search1  

If you poll **two endpoints** (TripUpdates + VehiclePositions):

- **Every 30s** → 2 requests/minute per endpoint → 2,880/day per endpoint → **5,760/day total** (comfortably below 10,000/day). citeturn5search1  
- **Every 60s** → **2,880/day total**. citeturn5search1  
- **Every 300s** → **576/day total**. citeturn5search1  

So quota is not the limiting factor for 30s or 60s, assuming only these two endpoints. citeturn5search1

### What will become your true constraints at 30s

At 30 seconds cadence, sustainability is usually limited by:

- **Gold/Silver write amplification** (rows per cycle × cycles/day), which drives storage growth and vacuum pressure in Postgres. This is the primary risk if any “append‑forever at raw granularity” exists in Silver/Gold. (Your docs already show you intentionally bounded parts of Silver, which is good.) fileciteturn3file1L1-L1  
- **Query patterns from Power BI**, especially if you DirectQuery large fact tables without tight date filters or without “latest” isolation. Your docs already added `gold.latest_*` tables explicitly so KPI queries don’t scan full history. fileciteturn3file1L1-L1  
- **End‑to‑end cycle time vs. polling interval**: if capture + normalize + refresh takes >30s consistently, the worker will drift and “freshness” degrades even if polling is configured to 30s. Your docs describe a “start‑to‑start target cadence” for the worker, which implies you already think in these terms. fileciteturn3file1L1-L1  

### The good news about R2 costs at 30s

If you write one object per feed per poll (2 objects per cycle), **puts per month** at 30s cadence are ~172,800 writes/month (5,760/day × 30). That is well under R2’s free tier of **1 million Class A ops/month** (writes/lists/etc.), so operations cost should remain low for this workload shape. citeturn0search0

R2’s main cost driver becomes storage (GB‑month) rather than request count, because egress is free for all storage classes. citeturn0search0

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["bronze silver gold data architecture diagram","medallion architecture bronze silver gold pipeline","GTFS realtime pipeline architecture diagram"],"num_per_query":1}

## Option comparison and decision matrix

### Option A: Postgres hot data + R2 cold history

This option is effectively your current direction: keep raw protobuf snapshots (and static GTFS zips) in object storage for lineage/reprocessing, while keeping only what you need for fast BI in Postgres—especially for “latest” dashboards. fileciteturn3file1L1-L1

**Storage growth**  
Bounded if you apply time‑based retention on the high‑frequency Silver/Gold facts (days) and keep longer history either (a) downsampled rollups in Postgres, or (b) as raw objects (or Parquet exports) in R2. R2 storage is $0.015/GB‑month (standard) with a free tier (10 GB‑month). citeturn0search0

**Cost model fit for your stack**  
- R2: storage + operation classes; free egress; free tier on standard storage. citeturn0search0  
- Neon: usage‑based compute (CU‑hours) + storage ($/GB‑month) on paid plans; free plan has small included storage; autoscaling and scale‑to‑zero exist but frequent polling tends to keep compute “warm.” citeturn0search1  
- Railway: subscription + usage; billed for CPU, RAM, volume storage, and egress; published resource prices (RAM $10/GB‑month, CPU $20/vCPU‑month, volume $0.15/GB‑month). citeturn1search1  

**Query performance**  
Best if you keep dashboard‑facing tables small and/or time‑pruned and indexed, and restrict Power BI DirectQuery to “latest” and narrow windows (minutes/hours), while importing rollups for exploration. Your documented strategy (KPI views reading `gold.latest_*` rather than scanning history) is a strong pattern for this. fileciteturn3file1L1-L1

**Power BI compatibility**  
Strong: DirectQuery supports automatic page refresh for DirectQuery sources. Power BI Desktop minimum interval can be as low as 1 second; in the Service, the effective minimum is governed by capacity/admin settings (default minimums are commonly higher). citeturn0search2  
If you want “incremental refresh + real‑time DirectQuery partition” (hybrid tables), Power BI requires Premium/PPU/Embedded, and relationships to the hybrid table often must be in Dual mode for performance. citeturn1search3turn1search0

**Operational complexity**  
Moderate: you need lifecycle rules in object storage, retention jobs for Postgres partitions, and a clean separation of “hot vs. warm vs. cold.”

**Overkill?**  
No. This is the most industry‑standard “small but serious” pattern for your stated scale and budget.

### Option B: Postgres‑only with strict retention and rollups

Here, you would store both raw snapshots and analytics in Postgres (and delete aggressively), avoiding object storage except maybe for static GTFS archives.

**Storage growth**  
Manageable only if you (1) do strict retention on raw/high‑frequency data, (2) downsample early, and (3) partition tables so retention is cheap and predictable. Postgres range partitioning is purpose‑built for splitting big tables by date/time ranges and improving performance through partition pruning. citeturn2search1

**Cost model fit**  
Potentially worse for your priorities because Postgres storage is usually the most expensive $/GB component in this stack (Neon storage is priced per GB‑month on paid plans). citeturn0search1  
This option also increases vacuum/maintenance demands because you’re rewriting and deleting inside the database more.

**Query performance**  
Fine for “latest” and small windows; can degrade as history grows unless you roll up and avoid large scans. Partition pruning helps heavily when queries filter by the partition key. citeturn2search1  
BRIN indexes can be extremely space‑efficient for very large time‑ordered tables because they store summaries by physical block ranges (lossy but small), which is a natural fit for “append by time” telemetry tables. citeturn3search0

**Power BI compatibility**  
Same as Option A at the semantic layer, but you lose the cheap “cold history” tier.

**Operational complexity**  
Lower than Option A (fewer systems), but higher database‑tuning burden.

**Overkill?**  
Not overkill, but it’s the least cost‑efficient path if your priority is “don’t wake up to huge storage bills.”

### Option C: Add a specialized streaming / OLAP / time‑series component

This family includes:

- **OLAP column store** (e.g., entity["company","ClickHouse","database company"]): best at scanning/aggregating large history fast, with Power BI connector support (Import and DirectQuery) via ODBC. citeturn2search0  
- **Time‑series extensions in Postgres** (e.g., entity["company","Timescale","time-series database company"] TimescaleDB): hypertables, retention policies, compression/downsampling. Neon explicitly supports the `timescaledb` extension (including on newer Postgres versions). citeturn3search5  

**Storage growth**  
Usually best controlled here because you can combine:
- automatic chunk dropping via retention policies (e.g., Timescale `add_retention_policy`), citeturn4search1  
- and compression policies (example: compress chunks older than N days). citeturn4search5turn4search2  

**Cost model fit**  
- A second database (ClickHouse Cloud or hosted) increases monthly minimums and operational overhead, likely misaligned with “portfolio‑grade, low monthly cost.” citeturn2search0  
- TimescaleDB inside Neon is a “middle path” because it stays in Postgres (no new datastore), but it does increase conceptual complexity and might complicate portability.

**Query performance**  
- ClickHouse is excellent for analytic scans and aggregations across deep history; Power BI DirectQuery to ClickHouse is supported via the connector. citeturn2search0  
- Timescale continuous aggregates + compression can offer large wins on time‑series workloads while still serving SQL. citeturn4search5turn4search3  

**Power BI compatibility**  
- ClickHouse connector explicitly supports Import and DirectQuery. citeturn2search0  
- TimescaleDB is still Postgres to Power BI (no new connector), so compatibility is essentially unchanged, but modeling choices matter.

**Operational complexity**  
Highest if you add a new OLAP system; medium if you only add TimescaleDB extension.

**Overkill?**  
- ClickHouse / Kafka‑style streaming: likely overkill for V1 given your goals.  
- TimescaleDB extension: *maybe* worthwhile if you want a “time‑series‑native” story without adding an entire new platform, but not required.

### Decision matrix

| Criterion | Option A: Postgres hot + R2 cold | Option B: Postgres‑only | Option C: Specialized component |
|---|---|---|---|
| Storage growth risk at 30s | **Low–Medium** (bounded hot + cheap cold) citeturn0search0 | **Medium–High** (DB becomes the archive) citeturn0search1 | **Low** if engineered well (retention/compression), but depends on component citeturn4search1turn4search5turn2search0 |
| Cost predictability | **High** with retention tiers + autoscaling caps citeturn0search0turn0search1 | **Medium** (storage/vacuum surprise risk) citeturn0search1 | **Low–Medium** (new system minimums) unless only Timescale extension citeturn2search0turn3search5 |
| Dashboard query speed | **High** if latest tables + rollups are designed well fileciteturn3file1L1-L1 | **Medium–High** if aggressively rolled up + partitioned citeturn2search1 | **Highest** for deep history (OLAP), good for time‑series (Timescale) citeturn2search0turn4search5 |
| 30‑second polling suitability | **Yes** (quota OK; costs manageable) citeturn5search1turn0search0 | **Yes but brittle** unless strict retention is enforced citeturn2search1 | **Yes** (often best technically), but complexity may not match V1 goals citeturn2search0turn4search1 |
| Power BI “real‑time feel” | **Good** with DirectQuery + Auto Page Refresh citeturn0search2 | **Good** same pattern citeturn0search2 | **Good** (ClickHouse DirectQuery supported; Postgres remains Postgres) citeturn2search0turn0search2 |
| Operational complexity | **Moderate** | **Low–Moderate** | **High** (new OLAP) / **Moderate** (Timescale extension) citeturn3search5 |
| Overkill for portfolio V1 | **No** | **No** | **Often yes**, except possibly Timescale extension |

## Recommended architecture for your exact use case

### Recommendation

Choose **Option A (Postgres hot data + R2 cold history)**, with one refinement:

- Keep **“latest” operational tables** in Postgres for DirectQuery (fast, small, constantly updated). This matches your existing `gold.latest_*` approach. fileciteturn3file1L1-L1  
- Keep **high‑frequency history** in Postgres only for a short window (hot), then downsample/roll up to warm aggregates, and keep raw lineage in R2 (cold). R2 storage is cheap with free egress, making it well‑suited for “archive without regret.” citeturn0search0  
- Avoid adding a new OLAP/streaming system in V1. If you later want a “time‑series pro” enhancement without introducing a second database, consider TimescaleDB extension inside Neon as a V2 improvement (supported on Neon). citeturn3search5  

### Exact hot vs. warm vs. cold split

This split is designed to keep costs flat even if you run 30s polling.

**Hot (Neon Postgres, DirectQuery‑friendly)**
- `gold.latest_vehicle_snapshot`, `gold.latest_trip_delay_snapshot`, and KPI views: **keep indefinitely** (tiny tables). fileciteturn3file1L1-L1  
- High‑frequency snapshot facts (vehicle + trip delay) at full cadence: **retain 48 hours**. This matches what your documentation already describes as the default retention principle for realtime Silver, and extends the same principle to any Gold “raw‑grain” facts. fileciteturn3file1L1-L1  
- Realtime Silver raw‑grain tables: **retain 48 hours** (status quo per your docs). fileciteturn3file1L1-L1  

**Warm (Neon Postgres, mostly Import‑mode in Power BI)**
- 5‑minute rollups for route/stop/trip metrics: **retain 90 days**.
- 1‑hour rollups (optional): **retain 365 days**.
These are the tables you explore historically; they should be narrow and indexed for date slicing.

**Cold (R2)**
- Raw GTFS‑RT protobuf objects: **retain 30 days** in Standard storage (good portfolio window).  
  - If you later decide you want longer recall, you can retain 90–180 days, relying on R2’s low $/GB‑month and free egress. citeturn0search0  
- Raw static GTFS zips: **retain 365 days** (or indefinite). They’re relatively small, and they support provenance and reproducibility. fileciteturn3file1L1-L1  

### Exact cadences: polling, refresh, cleanup

These are tuned to both GTFS best practice and Power BI realities:

**Live polling cadence (Railway worker)**
- Poll GTFS‑RT TripUpdates + VehiclePositions every **30 seconds**. This aligns with GTFS‑RT best practices for update cadence and still fits STM quotas. citeturn5search5turn5search1  

**Gold “latest tables” refresh cadence**
- Refresh `gold.latest_*` every **30 seconds** (same as polling).  
This keeps the operational dashboard page “alive” without requiring a full historical rebuild. fileciteturn3file1L1-L1  

**Warm rollup cadence**
- Build/refresh 5‑minute aggregates every **5 minutes** (can run in the worker every 10 cycles or as a separate scheduled job). Keep the SQL incremental (only process new snapshots).  

**Cleanup cadences**
- **Daily**: drop hot partitions older than 48 hours (Silver + Gold raw‑grain).  
- **Daily or weekly**: `ANALYZE` large tables after partition drops (depending on observed plan stability).  
- **R2 lifecycle**: apply a **30‑day expiration** rule for realtime protobuf objects (static GTFS can be much longer). R2 billing is largely storage + operation classes; lifecycle transitions themselves are billable operations, but the overall model supports lifecycle management and predictable storage windows. citeturn0search0  

### Power BI approach that will actually feel “near‑real‑time”

Power BI’s “real‑time feel” is easiest when you isolate the live page to DirectQuery:

- Use **DirectQuery** to `gold.latest_*` tables and enable **Automatic page refresh** on that report page (Power BI Desktop + Service support this for DirectQuery sources). citeturn0search2  
- Use **Import mode** for warm rollups (90‑day 5‑minute, 365‑day hourly) and refresh those on a reasonable schedule (hourly/daily).  
- If you want the “incremental refresh + real‑time DirectQuery partition” hybrid pattern, note: enabling “get the latest data in real time with DirectQuery” is **Premium/PPU/Embedded only**, and hybrid tables require related tables often be set to **Dual** mode to avoid performance penalties. citeturn1search3turn1search0  

This matters for portfolio: you can build a great demo in Desktop (and even Service) without needing to pay for Premium features if you keep the real‑time experience on a DirectQuery “live page,” and keep analysis mode on imported rollups.

## Concrete schema, index, and retention patterns to implement

### Partition the raw‑grain history tables by time

If you keep raw‑grain history in Postgres at 30‑second polling, time partitioning is the cleanest lever for:
- predictable retention (drop partitions),
- predictable query speed (partition pruning),
- bounded index sizes.

Postgres declarative range partitioning is purpose‑built for tables partitioned by date/time ranges, and partition pruning can dramatically improve query performance when queries filter on that partition key. citeturn2search1

**Pattern**
- Partition `silver.vehicle_positions`, `silver.trip_updates`, and your raw‑grain Gold facts by `captured_at_utc` (or `feed_timestamp_utc`, pick one and be consistent).
- Create **daily partitions** for hot tables (because you only keep 48 hours, daily is perfect and avoids too many partitions).

### Use BRIN + selective B‑tree indexes on big time‑ordered tables

For large, append‑by‑time tables, BRIN indexes are designed for columns correlated with physical order (like timestamps). They are tiny and can help skip large ranges of blocks when scanning by time windows (lossy but efficient). citeturn3search0

**Pattern**
- BRIN on `captured_at_utc` / `feed_timestamp_utc` for each partition (or on the parent with partitioned indexes, depending on your migration approach).
- B‑tree indexes only on what you filter/join by frequently in dashboards:
  - `(provider_id, captured_at_utc DESC)`
  - `(provider_id, route_id, captured_at_utc DESC)` if you slice by routes
  - `(provider_id, vehicle_id, captured_at_utc DESC)` for vehicle drilldowns

### Keep “latest” tables truly small and avoid unnecessary rewrites

Your existing approach (explicit `gold.latest_*` tables that KPIs read directly) is exactly how you protect dashboards from large scans. fileciteturn3file1L1-L1  

To reduce bloat and lock pressure in these “latest” tables:
- When upserting, only update a row if the incoming feed timestamp is newer (or data differs). This reduces churn while preserving correctness.
- Ensure the “latest” tables have the narrowest practical schema: only what the dashboard needs *for the live page*.

### Rollups as first‑class Gold tables

Instead of letting Power BI aggregate raw‑grain facts at query time, generate warm tables:

- `gold.fact_vehicle_5m` (by provider, route, time_bucket_5m)  
- `gold.fact_delay_5m` (by provider, route, time_bucket_5m)  
- `gold.fact_stop_activity_5m` (by provider, stop, time_bucket_5m)  

That structure stays star‑schema friendly and massively reduces DirectQuery pressure.

### If you want an “industry‑standard time‑series” upgrade without adding a second DB

TimescaleDB provides:
- retention policies to drop chunks older than an interval (`add_retention_policy`), citeturn4search1  
- compression policies to compress chunks older than an interval (example shown as “older than 7 days”). citeturn4search5  

Neon explicitly supports installing the `timescaledb` extension (notably on newer Postgres versions). citeturn3search5  

This is **optional** for V1; vanilla Postgres partitioning + retention jobs is already “industry standard” and easier to reason about.

## What to avoid and a Claude Code prompt to keep execution focused

### What to avoid

Avoid these patterns if you want to keep costs flat and performance stable at 30 seconds:

- **Unbounded raw‑grain history** in Postgres (weeks/months of 30‑second snapshots without downsampling). This is the fastest route to storage creep and vacuum churn.
- **DirectQuery on big history tables** without strict query filters. If Power BI can accidentally issue a “scan a week of raw snapshots” query, it eventually will (especially when users click around).
- **Treating Power BI Import refresh like streaming.** Import refresh schedules are not meant for 30‑second updates; use DirectQuery + auto page refresh for the live page instead. citeturn0search2turn1search3  
- **Adding Kafka/streaming infrastructure in V1.** GTFS‑RT is polled via HTTP GET; introducing streaming middleware usually adds complexity without changing the data acquisition reality. citeturn5search4  
- **Adding a second analytics database (e.g., ClickHouse) now** unless you have a clear “deep history at scale” requirement. It’s powerful (and Power BI supports it), but it increases cost floor and operational surface area. citeturn2search0  

### Claude Code continuation prompt

```text
You are working inside my existing STM GTFS + GTFS-RT pipeline repo.

Goal: Make 30-second GTFS-RT polling sustainable and cheap on Neon Postgres + Cloudflare R2 + Railway, while keeping Power BI fast.

Context (existing):
- Bronze: raw GTFS and GTFS-RT snapshots archived to R2.
- Silver: normalized GTFS tables + normalized GTFS-RT tables.
- Gold: BI marts already exist, including gold.latest_* tables and refresh-gold-realtime path.
- Realtime worker runs repeated cycles; production cadence is now 30s (confirmed production-ready in Slice 6 of the Option A Optimization Phase).

Deliverables:
1) Implement a hot/warm/cold retention design:
   - Hot: keep raw-grain Silver + raw-grain Gold history for exactly 48 hours.
   - Warm: create 5-minute rollup Gold tables retained for 90 days (route/stop/trip level).
   - Cold: rely on R2 for raw protobuf retention (recommend a 30-day lifecycle policy; just document it).

2) Postgres schema changes (write migrations SQL):
   A) Convert raw-grain realtime history tables to RANGE partitioning by captured_at_utc (daily partitions).
   B) Add indexes:
      - BRIN on captured_at_utc for each partition (or partitioned index).
      - B-tree on (provider_id, captured_at_utc desc) and on the keys needed for dashboard slicing.
   C) Create a stored procedure (or SQL script) to:
      - create partitions for today + next 2 days (so inserts never fail),
      - drop partitions older than 48 hours (retention),
      - analyze affected tables.

3) Worker logic changes:
   - Separate “update gold.latest_*” (every cycle) from “append raw-grain history” (every cycle but bounded by retention) and “update 5-minute rollups” (every 5 minutes).
   - Ensure upserts into gold.latest_* only UPDATE when incoming feed_timestamp_utc is newer (or data changed) to reduce bloat.

4) Power BI guidance (in docs/):
   - Recommend DirectQuery to gold.latest_* + Automatic Page Refresh for the live page.
   - Recommend Import mode for 5-minute rollups; refresh hourly/daily.
   - Note that incremental refresh with real-time DirectQuery partition requires Premium; keep the portfolio build working without Premium.

Constraints:
- Keep it simple (no Kafka, no new OLAP DB in V1).
- Favor Postgres-native features (partitioning, indexes) and documented SQL.
- Output: migration SQL files + updated docs + any Python changes needed in the worker.

Start by:
- Inspecting current Silver/Gold table definitions and the refresh-gold-realtime SQL.
- Proposing exact DDL for partitioned tables and exact index statements.
- Implementing migrations and safe rollout steps.
```

