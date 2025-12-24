# Bronze Layer

The Bronze layer stores raw, unprocessed data exactly as received from source systems.

## Purpose

- **Minimal Transformation**: Data is stored in its original format
- **Historical Preservation**: Enables reprocessing and historical analysis
- **Fast Ingestion**: Minimal validation for rapid data collection
- **Data Lineage**: Maintains original source information

## Components

### Workers

- **`transit-gtfs-static-worker`**: Handles logging and optional fetching of GTFS static data
  - Location: `bronze/workers/transit-gtfs-static-worker/`
  - Endpoints: `/log` (POST) for secure logging
  - Bindings: D1 database `transit-bronze`, R2 bucket `transit-bronze`
  - Data: GTFS static ZIP files → `gtfs-static/{provider}/dt={YYYY-MM-DD}/`

- **`transit-gtfsrt-worker`**: Processes real-time GTFS-RT data
  - Location: `bronze/workers/transit-gtfsrt-worker/`
  - Schedule: Cloudflare cron (configurable, typically every 15 minutes)
  - Process: Fetches GTFS-RT feeds → Parses protobuf metadata → Stores raw .pb files
  - Bindings: D1 database `transit-bronze`, R2 bucket `transit-bronze`
  - Data: GTFS-RT protobuf files → `gtfs-rt/{provider}/{feed_kind}/dt={YYYY-MM-DD}/`
  - Flow: Bronze → Gold (hot data, last 24h) or Bronze → Silver → Gold (historical data, 24h+)

### Ingestion

- **`fetch-stm-gtfs.yml`**: Scheduled daily ingestion of STM GTFS data
  - Location: `.github/workflows/fetch-stm-gtfs.yml`
  - Schedule: Daily at 07:10 UTC (~03:10 Montreal)
  - Process: Downloads GTFS ZIP → Uploads to R2 → Logs to D1

## Data Storage

- **R2 Bucket**: `transit-bronze`
- **Naming Convention**:
  - **GTFS Static**: `gtfs-static/{provider}/dt={YYYY-MM-DD}/gtfs_{provider}_{date}.zip`
  - **GTFS-RT**: `gtfs-rt/{provider}/{feed_kind}/dt={YYYY-MM-DD}/{feed_kind}_{timestamp}.pb`
- **Formats**:
  - GTFS Static: ZIP files (raw, unprocessed)
  - GTFS-RT: Protobuf files (raw, unprocessed)
- **Examples**:
  - Static: `gtfs-static/stm/dt=2025-12-23/gtfs_stm_2025-12-23.zip`
  - RT: `gtfs-rt/stm/gtfsrt_trip_updates/dt=2025-12-23/gtfsrt_trip_updates_2025-12-23T03-15-30.pb`

## Database

- **D1 Database**: `transit-bronze`
- **Tables**:
  - `ingest_log`: Logs all ingestion events (static and RT)
  - `gtfs_files`: Tracks GTFS static files
  - `rt_trip_updates_raw`: Tracks GTFS-RT trip update feeds
  - `rt_vehicle_positions_raw`: Tracks GTFS-RT vehicle position feeds
  - `feed_endpoints`: Configuration for feed endpoints

## Usage

See main [README.md](../README.md) for setup and development instructions.

