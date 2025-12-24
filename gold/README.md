# Gold Layer

The Gold layer provides business-level aggregated datasets, curated views, and API services optimized for analytics, reporting, and real-time consumption.

## Purpose

- **API Services**: Real-time data APIs for PowerBI and GIS systems
- **Aggregated Metrics**: Business intelligence datasets from Silver layer
- **Analytics-Ready**: Curated tables optimized for reporting
- **Real-Time Serving**: Low-latency access to current data

## Components

### Workers

- **`transit-rt-api-worker`**: Serves real-time GTFS-RT data via REST API
  - Location: `gold/workers/transit-rt-api-worker/`
  - Purpose: Read RT data from Bronze (hot) and D1 (historical) and serve as JSON/GeoJSON
  - Data Flow: 
    - Hot RT: Bronze → Gold (last 24 hours, direct access from R2)
    - Historical RT: D1 → Gold (24+ hours, aggregated data from D1)
  - Bindings: 
    - `R2_BRONZE`: Read hot RT data from `transit-bronze` bucket
    - `R2_SILVER`: Read historical RT Parquet files from `transit-silver` bucket (archive)
    - `DB`: D1 database `transit-bronze` (for historical RT aggregations and static data)

- **`transit-static-api-worker`**: Serves GTFS static data via REST API
  - Location: `gold/workers/transit-static-api-worker/`
  - Purpose: Query and serve GTFS static data from D1 database
  - Data Flow: D1 → Gold (static data loaded by Silver ETL)
  - Bindings:
    - `DB`: D1 database `transit-bronze` (for static GTFS data)

## API Endpoints

### RT API Worker (`transit-rt-api-worker`)

#### Hot RT Data (from Bronze, last 24h)

- `GET /api/v1/rt/current` - Latest trip updates (all routes)
- `GET /api/v1/rt/current?route_id={id}` - Trip updates for specific route
- `GET /api/v1/rt/current?stop_id={id}` - Trip updates for specific stop
- `GET /api/v1/rt/positions` - Current vehicle positions (all)
- `GET /api/v1/rt/positions?route_id={id}` - Vehicle positions for route
- `GET /api/v1/rt/positions?vehicle_id={id}` - Specific vehicle position

#### Historical RT Data (from D1, 24h+)

- `GET /api/v1/rt/historical?date={YYYY-MM-DD}&hour={HH}` - Hourly aggregated data
- `GET /api/v1/rt/historical?date={YYYY-MM-DD}` - Daily aggregated data
- `GET /api/v1/rt/historical/range?start={YYYY-MM-DD}&end={YYYY-MM-DD}` - Date range query
- Query parameters: `feed_kind`, `route_id`, `stop_id`, `provider`

#### GeoJSON Endpoints (for GIS)

- `GET /api/v1/rt/geojson/positions` - Current positions as GeoJSON
- `GET /api/v1/rt/geojson/positions?route_id={id}` - Route positions as GeoJSON
- `GET /api/v1/rt/geojson/historical-positions?date={YYYY-MM-DD}&hour={HH}` - Historical positions as GeoJSON

#### Analytics Endpoints

- `GET /api/v1/analytics/delays-by-route?start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}` - Average delays by route
- `GET /api/v1/analytics/delays-by-stop?start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}` - Average delays by stop
- `GET /api/v1/analytics/on-time-performance?start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}&threshold={seconds}` - On-time performance metrics
- `GET /api/v1/analytics/peak-hours?date={YYYY-MM-DD}` - Peak hour analysis

#### Metadata

- `GET /api/v1/rt/status` - API status, latest feed timestamps, data availability

### Static API Worker (`transit-static-api-worker`)

#### Static Data Endpoints

- `GET /api/v1/static/routes` - List all routes
- `GET /api/v1/static/routes?route_id={id}` - Get specific route
- `GET /api/v1/static/routes?route_type={type}` - Filter by route type
- `GET /api/v1/static/stops` - List all stops
- `GET /api/v1/static/stops?stop_id={id}` - Get specific stop
- `GET /api/v1/static/stops?lat={lat}&lon={lon}&radius={m}` - Nearby stops
- `GET /api/v1/static/trips` - List trips (with pagination)
- `GET /api/v1/static/trips?route_id={id}` - Get trips for route
- `GET /api/v1/static/stop-times?trip_id={id}` - Get stop times for trip
- `GET /api/v1/static/shapes?route_id={id}` - Get route shape
- `GET /api/v1/static/shapes?shape_id={id}` - Get shape by ID

#### GeoJSON Endpoints

- `GET /api/v1/geojson/stops` - All stops as GeoJSON
- `GET /api/v1/geojson/stops?route_id={id}` - Stops for route as GeoJSON
- `GET /api/v1/geojson/routes` - All route shapes as GeoJSON
- `GET /api/v1/geojson/routes?route_id={id}` - Route shape as GeoJSON
- `GET /api/v1/geojson/shapes?route_id={id}` - Route shape as GeoJSON

All endpoints support `provider` parameter (default: `stm`) and pagination via `limit` and `offset`.

## Data Flow

**RT Data Architecture:**
- **Hot RT** (last 24h): Bronze → Gold (direct, no Silver processing)
  - RT worker stores raw `.pb` files in Bronze bucket
  - Gold API worker reads and serves RT data on-demand with minimal latency
  
- **Historical RT** (24h+): Bronze → Silver → D1 → Gold (with aggregation)
  - Silver ETL processes older RT data (hourly/daily aggregations)
  - Aggregations stored in D1 database (`rt_delays_hourly`, `rt_delays_daily`, `rt_positions_hourly`, `rt_positions_daily`)
  - Gold API worker queries D1 for fast SQL-based access
  - Parquet files also created in Silver bucket for archive/backup

**Static Data**: Bronze → Silver → D1 → Gold (with processing)
- Static data is processed through Silver (Parquet conversion + D1 loading)
- All GTFS static tables loaded into D1 (`routes`, `stops`, `trips`, `stop_times`, `shapes`, etc.)
- Gold Static API worker queries D1 for fast SQL-based access
- Parquet files also created in Silver bucket for archive/backup

## Naming Conventions

- **GTFS Static**: `gtfs-static/` prefix (in both Bronze and Silver)
- **GTFS-RT**: `gtfs-rt/` prefix (in Bronze for hot data, in Silver for historical aggregations)

## GIS Web Interface

A simple web-based map interface is available at `/map.html` (when deployed with static file serving) that displays:
- Real-time vehicle positions
- Route shapes and stops
- Historical position data
- Interactive filtering by route and date

## PowerBI Integration

The analytics endpoints are optimized for PowerBI consumption:
- `/api/v1/analytics/delays-by-route` - Join RT + static data for route-level metrics
- `/api/v1/analytics/delays-by-stop` - Join RT + static data for stop-level metrics
- `/api/v1/analytics/on-time-performance` - OTP metrics by route
- `/api/v1/analytics/peak-hours` - Peak hour analysis

All endpoints return JSON with proper data types and can be consumed directly by PowerBI via web data source.

## Status

✅ **RT API Worker**: Implemented and operational
✅ **Static Data API Worker**: Implemented and operational
✅ **D1 Database Integration**: Complete (static + RT aggregations)
✅ **Analytics Endpoints**: Implemented
✅ **GeoJSON Endpoints**: Complete for RT and static data
✅ **GIS Web Interface**: Available at `/map.html`

