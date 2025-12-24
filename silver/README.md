# Silver Layer

The Silver layer stores cleaned, validated, and transformed data ready for analysis.

## Purpose

- **Data Quality**: Validated and standardized data
- **Optimized Format**: Parquet files for efficient querying
- **Type Safety**: Proper data types and schema enforcement
- **Analytics Ready**: Structured for downstream analysis

## Components

### ETL

- **`gtfs-to-silver.py`**: Transforms bronze GTFS ZIP to silver Parquet
  - Location: `silver/etl/gtfs-to-silver.py`
  - Process: Reads bronze ZIP → Extracts CSV → Validates → Converts to Parquet
  - Output: Parquet files + manifest.json

- **`silver-gtfs.yml`**: Scheduled ETL workflow
  - Location: `.github/workflows/silver-gtfs.yml`
  - Schedule: Daily at 07:30 UTC (~03:30 Montreal)
  - Process: Runs ETL script → Uploads Parquet files → Logs completion

- **`rt-historical-to-silver.py`**: Processes historical GTFS-RT data (24h+ old)
  - Location: `silver/etl/rt-historical-to-silver.py`
  - Process: Reads RT .pb files from Bronze → Aggregates hourly and daily → Outputs Parquet
  - Output: Aggregated Parquet files (hourly and daily)
  - Aggregations: Trip updates and vehicle positions with metrics (delays, counts, positions)

- **`silver-rt.yml`**: Scheduled RT ETL workflow
  - Location: `.github/workflows/silver-rt.yml`
  - Schedule: Daily at 08:00 UTC (~04:00 Montreal)
  - Process: Runs RT ETL script → Processes files older than 24h → Uploads aggregated Parquet

## Data Storage

- **R2 Bucket**: `transit-silver`
- **Format**: Parquet files (columnar, compressed)
- **Organization**:
  - Static: `gtfs-static/{provider}/dt={YYYY-MM-DD}/{table}.parquet`
  - RT Historical (Hourly): `gtfs-rt/{provider}/{feed_kind}/dt={YYYY-MM-DD}/rt_{feed_kind}_hourly_{YYYY-MM-DD-HH}.parquet`
  - RT Historical (Daily): `gtfs-rt/{provider}/{feed_kind}/dt={YYYY-MM-DD}/rt_{feed_kind}_daily_{YYYY-MM-DD}.parquet`
- **Naming Convention**: Uses `gtfs-static/` prefix for static data, `gtfs-rt/` prefix for RT historical aggregations
- **Examples**:
  - Static: `gtfs-static/stm/dt=2025-12-23/routes.parquet`
  - RT Hourly: `gtfs-rt/stm/gtfsrt_trip_updates/dt=2025-12-23/rt_gtfsrt_trip_updates_hourly_2025-12-23-14.parquet`
  - RT Daily: `gtfs-rt/stm/gtfsrt_trip_updates/dt=2025-12-23/rt_gtfsrt_trip_updates_daily_2025-12-23.parquet`

## Tables Processed

The ETL script processes the following GTFS tables:
- `agency.txt` → `agency.parquet`
- `routes.txt` → `routes.parquet`
- `trips.txt` → `trips.parquet`
- `stops.txt` → `stops.parquet`
- `stop_times.txt` → `stop_times.parquet`
- `calendar.txt` → `calendar.parquet`
- `calendar_dates.txt` → `calendar_dates.parquet`
- `shapes.txt` → `shapes.parquet`
- `feed_info.txt` → `feed_info.parquet`

## Usage

See main [README.md](../README.md) for setup and development instructions.

