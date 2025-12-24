-- D1 Migration: Create RT Historical Aggregation Tables
-- This migration creates tables for storing aggregated RT data (hourly and daily)

-- RT Delays Hourly Aggregation
CREATE TABLE IF NOT EXISTS rt_delays_hourly (
    provider_key TEXT NOT NULL,
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    route_id TEXT,
    stop_id TEXT,
    trip_id TEXT,
    avg_arrival_delay REAL,
    max_arrival_delay INTEGER,
    min_arrival_delay INTEGER,
    avg_departure_delay REAL,
    max_departure_delay INTEGER,
    min_departure_delay INTEGER,
    trip_count INTEGER,
    route_count INTEGER,
    stop_count INTEGER,
    PRIMARY KEY (provider_key, date, hour, route_id, stop_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_delays_hourly_provider_date ON rt_delays_hourly(provider_key, date);
CREATE INDEX IF NOT EXISTS idx_rt_delays_hourly_date_hour ON rt_delays_hourly(date, hour);
CREATE INDEX IF NOT EXISTS idx_rt_delays_hourly_route ON rt_delays_hourly(route_id);
CREATE INDEX IF NOT EXISTS idx_rt_delays_hourly_stop ON rt_delays_hourly(stop_id);
CREATE INDEX IF NOT EXISTS idx_rt_delays_hourly_route_stop ON rt_delays_hourly(route_id, stop_id);

-- RT Delays Daily Aggregation
CREATE TABLE IF NOT EXISTS rt_delays_daily (
    provider_key TEXT NOT NULL,
    date TEXT NOT NULL,
    route_id TEXT,
    stop_id TEXT,
    trip_id TEXT,
    avg_arrival_delay REAL,
    max_arrival_delay INTEGER,
    min_arrival_delay INTEGER,
    avg_departure_delay REAL,
    max_departure_delay INTEGER,
    min_departure_delay INTEGER,
    trip_count INTEGER,
    route_count INTEGER,
    stop_count INTEGER,
    PRIMARY KEY (provider_key, date, route_id, stop_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_delays_daily_provider_date ON rt_delays_daily(provider_key, date);
CREATE INDEX IF NOT EXISTS idx_rt_delays_daily_date ON rt_delays_daily(date);
CREATE INDEX IF NOT EXISTS idx_rt_delays_daily_route ON rt_delays_daily(route_id);
CREATE INDEX IF NOT EXISTS idx_rt_delays_daily_stop ON rt_delays_daily(stop_id);
CREATE INDEX IF NOT EXISTS idx_rt_delays_daily_route_stop ON rt_delays_daily(route_id, stop_id);

-- RT Positions Hourly Aggregation
CREATE TABLE IF NOT EXISTS rt_positions_hourly (
    provider_key TEXT NOT NULL,
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    route_id TEXT,
    vehicle_id TEXT,
    trip_id TEXT,
    avg_latitude REAL,
    avg_longitude REAL,
    avg_bearing REAL,
    avg_speed REAL,
    max_speed REAL,
    vehicle_count INTEGER,
    route_count INTEGER,
    PRIMARY KEY (provider_key, date, hour, route_id, vehicle_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_positions_hourly_provider_date ON rt_positions_hourly(provider_key, date);
CREATE INDEX IF NOT EXISTS idx_rt_positions_hourly_date_hour ON rt_positions_hourly(date, hour);
CREATE INDEX IF NOT EXISTS idx_rt_positions_hourly_route ON rt_positions_hourly(route_id);
CREATE INDEX IF NOT EXISTS idx_rt_positions_hourly_vehicle ON rt_positions_hourly(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rt_positions_hourly_location ON rt_positions_hourly(avg_latitude, avg_longitude);

-- RT Positions Daily Aggregation
CREATE TABLE IF NOT EXISTS rt_positions_daily (
    provider_key TEXT NOT NULL,
    date TEXT NOT NULL,
    route_id TEXT,
    vehicle_id TEXT,
    trip_id TEXT,
    avg_latitude REAL,
    avg_longitude REAL,
    avg_bearing REAL,
    avg_speed REAL,
    max_speed REAL,
    vehicle_count INTEGER,
    route_count INTEGER,
    PRIMARY KEY (provider_key, date, route_id, vehicle_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_rt_positions_daily_provider_date ON rt_positions_daily(provider_key, date);
CREATE INDEX IF NOT EXISTS idx_rt_positions_daily_date ON rt_positions_daily(date);
CREATE INDEX IF NOT EXISTS idx_rt_positions_daily_route ON rt_positions_daily(route_id);
CREATE INDEX IF NOT EXISTS idx_rt_positions_daily_vehicle ON rt_positions_daily(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rt_positions_daily_location ON rt_positions_daily(avg_latitude, avg_longitude);


