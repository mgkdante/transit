-- D1 Migration: Create GTFS Static Tables
-- This migration creates all GTFS static data tables with proper indexes

-- Agency table
CREATE TABLE IF NOT EXISTS agency (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    agency_id TEXT,
    agency_name TEXT,
    agency_url TEXT,
    agency_timezone TEXT,
    agency_lang TEXT,
    agency_phone TEXT,
    agency_fare_url TEXT,
    agency_email TEXT,
    PRIMARY KEY (provider_key, feed_date, agency_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_provider_date ON agency(provider_key, feed_date);

-- Routes table
CREATE TABLE IF NOT EXISTS routes (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    route_id TEXT NOT NULL,
    agency_id TEXT,
    route_short_name TEXT,
    route_long_name TEXT,
    route_desc TEXT,
    route_type INTEGER,
    route_url TEXT,
    route_color TEXT,
    route_text_color TEXT,
    PRIMARY KEY (provider_key, feed_date, route_id)
);

CREATE INDEX IF NOT EXISTS idx_routes_provider_date ON routes(provider_key, feed_date);
CREATE INDEX IF NOT EXISTS idx_routes_route_id ON routes(route_id);
CREATE INDEX IF NOT EXISTS idx_routes_route_type ON routes(route_type);

-- Stops table
CREATE TABLE IF NOT EXISTS stops (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    stop_id TEXT NOT NULL,
    stop_code TEXT,
    stop_name TEXT,
    stop_desc TEXT,
    stop_lat REAL,
    stop_lon REAL,
    zone_id TEXT,
    stop_url TEXT,
    location_type INTEGER,
    parent_station TEXT,
    stop_timezone TEXT,
    wheelchair_boarding INTEGER,
    level_id TEXT,
    platform_code TEXT,
    PRIMARY KEY (provider_key, feed_date, stop_id)
);

CREATE INDEX IF NOT EXISTS idx_stops_provider_date ON stops(provider_key, feed_date);
CREATE INDEX IF NOT EXISTS idx_stops_stop_id ON stops(stop_id);
CREATE INDEX IF NOT EXISTS idx_stops_location ON stops(stop_lat, stop_lon);

-- Trips table
CREATE TABLE IF NOT EXISTS trips (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    route_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    trip_headsign TEXT,
    trip_short_name TEXT,
    direction_id INTEGER,
    block_id TEXT,
    shape_id TEXT,
    wheelchair_accessible INTEGER,
    bikes_allowed INTEGER,
    PRIMARY KEY (provider_key, feed_date, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_trips_provider_date ON trips(provider_key, feed_date);
CREATE INDEX IF NOT EXISTS idx_trips_trip_id ON trips(trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_route_id ON trips(route_id);
CREATE INDEX IF NOT EXISTS idx_trips_service_id ON trips(service_id);
CREATE INDEX IF NOT EXISTS idx_trips_shape_id ON trips(shape_id);

-- Stop times table
CREATE TABLE IF NOT EXISTS stop_times (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    arrival_time TEXT,
    departure_time TEXT,
    stop_id TEXT NOT NULL,
    stop_sequence INTEGER NOT NULL,
    stop_headsign TEXT,
    pickup_type INTEGER,
    drop_off_type INTEGER,
    shape_dist_traveled REAL,
    timepoint INTEGER,
    PRIMARY KEY (provider_key, feed_date, trip_id, stop_sequence)
);

CREATE INDEX IF NOT EXISTS idx_stop_times_provider_date ON stop_times(provider_key, feed_date);
CREATE INDEX IF NOT EXISTS idx_stop_times_trip_id ON stop_times(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_stop_id ON stop_times(stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_trip_stop ON stop_times(trip_id, stop_id);

-- Calendar table
CREATE TABLE IF NOT EXISTS calendar (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    service_id TEXT NOT NULL,
    monday INTEGER,
    tuesday INTEGER,
    wednesday INTEGER,
    thursday INTEGER,
    friday INTEGER,
    saturday INTEGER,
    sunday INTEGER,
    start_date TEXT,
    end_date TEXT,
    PRIMARY KEY (provider_key, feed_date, service_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_provider_date ON calendar(provider_key, feed_date);
CREATE INDEX IF NOT EXISTS idx_calendar_service_id ON calendar(service_id);

-- Calendar dates table
CREATE TABLE IF NOT EXISTS calendar_dates (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    service_id TEXT NOT NULL,
    date TEXT NOT NULL,
    exception_type INTEGER,
    PRIMARY KEY (provider_key, feed_date, service_id, date)
);

CREATE INDEX IF NOT EXISTS idx_calendar_dates_provider_date ON calendar_dates(provider_key, feed_date);
CREATE INDEX IF NOT EXISTS idx_calendar_dates_service_id ON calendar_dates(service_id);
CREATE INDEX IF NOT EXISTS idx_calendar_dates_date ON calendar_dates(date);

-- Shapes table
CREATE TABLE IF NOT EXISTS shapes (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    shape_id TEXT NOT NULL,
    shape_pt_lat REAL NOT NULL,
    shape_pt_lon REAL NOT NULL,
    shape_pt_sequence INTEGER NOT NULL,
    shape_dist_traveled REAL,
    PRIMARY KEY (provider_key, feed_date, shape_id, shape_pt_sequence)
);

CREATE INDEX IF NOT EXISTS idx_shapes_provider_date ON shapes(provider_key, feed_date);
CREATE INDEX IF NOT EXISTS idx_shapes_shape_id ON shapes(shape_id);

-- Feed info table
CREATE TABLE IF NOT EXISTS feed_info (
    provider_key TEXT NOT NULL,
    feed_date TEXT NOT NULL,
    feed_publisher_name TEXT,
    feed_publisher_url TEXT,
    feed_lang TEXT,
    default_lang TEXT,
    feed_start_date TEXT,
    feed_end_date TEXT,
    feed_version TEXT,
    PRIMARY KEY (provider_key, feed_date)
);

CREATE INDEX IF NOT EXISTS idx_feed_info_provider_date ON feed_info(provider_key, feed_date);


