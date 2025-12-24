#!/usr/bin/env python3
"""
RT Historical ETL Script
Processes GTFS-RT protobuf files older than 24 hours from Bronze bucket.
Aggregates data hourly and daily, outputs Parquet files to Silver bucket and loads into D1.
"""
import os
import io
import sys
import json
import tempfile
import subprocess
from datetime import datetime, timedelta, timezone
from collections import defaultdict

import pandas as pd
import boto3
import requests
from google.transit import gtfs_realtime_pb2

# ---------- Config (env) ----------
ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
BRONZE_BUCKET = os.environ["R2_BUCKET"]  # e.g. transit-bronze
SILVER_BUCKET = os.environ["R2_SILVER_BUCKET"]  # e.g. transit-silver
PROVIDER = os.getenv("PROVIDER_KEY", "stm")
FEED_KIND = os.getenv("FEED_KIND", "")  # optional: gtfsrt_trip_updates or gtfsrt_vehicle_positions
PROCESS_DATE = os.getenv("RT_DATE")  # optional YYYY-MM-DD, defaults to yesterday
WORKER_LOG_URL = os.getenv("WORKER_LOG_URL", "")
WORKER_LOG_SECRET = os.getenv("WORKER_LOG_SECRET", "")
D1_DATABASE_NAME = os.getenv("D1_DATABASE_NAME", "transit-bronze")
D1_DATABASE_ID = os.getenv("D1_DATABASE_ID", "7fc37116-50c7-4c5f-bf6b-6c9a958b0140")

# 24 hour threshold for historical processing
HOT_DATA_THRESHOLD_HOURS = 24

ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="auto",
)

# Montreal timezone
MONTREAL_TZ = timezone(timedelta(hours=-5))  # EST/EDT approximation


def list_objects(bucket, prefix):
    """List all objects with given prefix."""
    resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
    return resp.get("Contents", [])


def get_historical_dates(provider):
    """Get dates to process (older than 24 hours)."""
    if PROCESS_DATE:
        return [PROCESS_DATE]
    
    # Get all dates from Bronze bucket
    base = f"gtfs-rt/{provider}/"
    resp = list_objects(BRONZE_BUCKET, base)
    dates = set()
    
    for obj in resp:
        parts = obj["Key"].split("/")
        for p in parts:
            if p.startswith("dt="):
                dates.add(p.split("=", 1)[1])
    
    if not dates:
        print(f"[silver-rt] No RT data found for {provider}", flush=True)
        return []
    
    # Filter dates older than 24 hours
    now = datetime.now(MONTREAL_TZ)
    threshold = now - timedelta(hours=HOT_DATA_THRESHOLD_HOURS)
    historical_dates = []
    
    for dt_str in sorted(dates):
        try:
            dt = datetime.strptime(dt_str, "%Y-%m-%d").replace(tzinfo=MONTREAL_TZ)
            if dt < threshold:
                historical_dates.append(dt_str)
        except ValueError:
            continue
    
    return historical_dates


def parse_protobuf_file(bucket, key):
    """Parse a GTFS-RT protobuf file and extract entities."""
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        data = obj["Body"].read()
        
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(data)
        
        return feed
    except Exception as e:
        print(f"[silver-rt] Error parsing {key}: {e}", file=sys.stderr, flush=True)
        return None


def extract_trip_updates(feed, file_timestamp):
    """Extract trip update entities from feed."""
    records = []
    
    for entity in feed.entity:
        if not entity.HasField("trip_update"):
            continue
        
        tu = entity.trip_update
        trip_id = tu.trip.trip_id if tu.trip.trip_id else None
        route_id = tu.trip.route_id if tu.trip.route_id else None
        
        for stop_time_update in tu.stop_time_update:
            record = {
                "trip_id": trip_id,
                "route_id": route_id,
                "stop_id": stop_time_update.stop_id if stop_time_update.stop_id else None,
                "stop_sequence": stop_time_update.stop_sequence if stop_time_update.stop_sequence else None,
                "arrival_delay": stop_time_update.arrival.delay if stop_time_update.arrival.delay else None,
                "departure_delay": stop_time_update.departure.delay if stop_time_update.departure.delay else None,
                "arrival_time": stop_time_update.arrival.time if stop_time_update.arrival.time else None,
                "departure_time": stop_time_update.departure.time if stop_time_update.departure.time else None,
                "feed_timestamp": feed.header.timestamp if feed.header.timestamp else None,
                "file_timestamp": file_timestamp,
            }
            records.append(record)
    
    return records


def extract_vehicle_positions(feed, file_timestamp):
    """Extract vehicle position entities from feed."""
    records = []
    
    for entity in feed.entity:
        if not entity.HasField("vehicle"):
            continue
        
        vp = entity.vehicle
        trip_id = vp.trip.trip_id if vp.trip.trip_id else None
        route_id = vp.trip.route_id if vp.trip.route_id else None
        vehicle_id = vp.vehicle.id if vp.vehicle.id else None
        
        record = {
            "vehicle_id": vehicle_id,
            "trip_id": trip_id,
            "route_id": route_id,
            "latitude": vp.position.latitude if vp.position.latitude else None,
            "longitude": vp.position.longitude if vp.position.longitude else None,
            "bearing": vp.position.bearing if vp.position.bearing else None,
            "speed": vp.position.speed if vp.position.speed else None,
            "timestamp": vp.timestamp if vp.timestamp else None,
            "feed_timestamp": feed.header.timestamp if feed.header.timestamp else None,
            "file_timestamp": file_timestamp,
        }
        records.append(record)
    
    return records


def aggregate_hourly(df, date_col="file_timestamp"):
    """Aggregate data by hour."""
    if df.empty:
        return pd.DataFrame()
    
    df[date_col] = pd.to_datetime(df[date_col], unit="s", errors="coerce")
    df["hour"] = df[date_col].dt.floor("H")
    
    agg_dict = {}
    
    # Common aggregations
    if "trip_id" in df.columns:
        agg_dict["trip_count"] = ("trip_id", "nunique")
    if "route_id" in df.columns:
        agg_dict["route_count"] = ("route_id", "nunique")
    if "vehicle_id" in df.columns:
        agg_dict["vehicle_count"] = ("vehicle_id", "nunique")
    
    # Delay aggregations
    if "arrival_delay" in df.columns:
        agg_dict["avg_arrival_delay"] = ("arrival_delay", "mean")
        agg_dict["max_arrival_delay"] = ("arrival_delay", "max")
        agg_dict["min_arrival_delay"] = ("arrival_delay", "min")
    
    if "departure_delay" in df.columns:
        agg_dict["avg_departure_delay"] = ("departure_delay", "mean")
        agg_dict["max_departure_delay"] = ("departure_delay", "max")
        agg_dict["min_departure_delay"] = ("departure_delay", "min")
    
    # Position aggregations
    if "latitude" in df.columns and "longitude" in df.columns:
        agg_dict["avg_latitude"] = ("latitude", "mean")
        agg_dict["avg_longitude"] = ("longitude", "mean")
    
    if "speed" in df.columns:
        agg_dict["avg_speed"] = ("speed", "mean")
        agg_dict["max_speed"] = ("speed", "max")
    
    if not agg_dict:
        return pd.DataFrame()
    
    grouped = df.groupby("hour").agg(agg_dict)
    grouped.columns = ["_".join(col).strip() for col in grouped.columns.values]
    grouped = grouped.reset_index()
    grouped["hour_str"] = grouped["hour"].dt.strftime("%Y-%m-%d-%H")
    
    return grouped


def aggregate_daily(df, date_col="file_timestamp"):
    """Aggregate data by day."""
    if df.empty:
        return pd.DataFrame()
    
    df[date_col] = pd.to_datetime(df[date_col], unit="s", errors="coerce")
    df["date"] = df[date_col].dt.date
    
    agg_dict = {}
    
    # Common aggregations
    if "trip_id" in df.columns:
        agg_dict["trip_count"] = ("trip_id", "nunique")
    if "route_id" in df.columns:
        agg_dict["route_count"] = ("route_id", "nunique")
    if "vehicle_id" in df.columns:
        agg_dict["vehicle_count"] = ("vehicle_id", "nunique")
    
    # Delay aggregations
    if "arrival_delay" in df.columns:
        agg_dict["avg_arrival_delay"] = ("arrival_delay", "mean")
        agg_dict["max_arrival_delay"] = ("arrival_delay", "max")
        agg_dict["min_arrival_delay"] = ("arrival_delay", "min")
    
    if "departure_delay" in df.columns:
        agg_dict["avg_departure_delay"] = ("departure_delay", "mean")
        agg_dict["max_departure_delay"] = ("departure_delay", "max")
        agg_dict["min_departure_delay"] = ("departure_delay", "min")
    
    # Position aggregations
    if "latitude" in df.columns and "longitude" in df.columns:
        agg_dict["avg_latitude"] = ("latitude", "mean")
        agg_dict["avg_longitude"] = ("longitude", "mean")
    
    if "speed" in df.columns:
        agg_dict["avg_speed"] = ("speed", "mean")
        agg_dict["max_speed"] = ("speed", "max")
    
    if not agg_dict:
        return pd.DataFrame()
    
    grouped = df.groupby("date").agg(agg_dict)
    grouped.columns = ["_".join(col).strip() for col in grouped.columns.values]
    grouped = grouped.reset_index()
    grouped["date_str"] = grouped["date"].astype(str)
    
    return grouped


def upload_parquet(bucket, key, df):
    """Upload DataFrame as Parquet to R2."""
    if df.empty:
        return False
    
    pbuf = io.BytesIO()
    df.to_parquet(pbuf, index=False, engine="pyarrow")
    pbuf.seek(0)
    
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=pbuf.read(),
        ContentType="application/octet-stream"
    )
    return True

def execute_d1_sql(sql):
    """Execute SQL on D1 database using wrangler CLI."""
    try:
        # Ensure CLOUDFLARE_API_TOKEN is available from environment
        env = os.environ.copy()
        cmd = ["npx", "wrangler", "d1", "execute", D1_DATABASE_NAME, "--command", sql, "--remote"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env)
        # Log success for debugging
        if result.stdout:
            print(f"[d1] SQL executed successfully: {len(result.stdout)} chars output", flush=True)
        return result.stdout
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr or e.stdout or str(e)
        print(f"[d1] Error executing SQL: {error_msg}", file=sys.stderr, flush=True)
        print(f"[d1] SQL that failed (first 200 chars): {sql[:200]}", file=sys.stderr, flush=True)
        raise

def clear_old_d1_rt_data(provider, date, table_name, hour=None):
    """Clear old RT aggregation data."""
    if hour is not None:
        sql = f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND date = '{date}' AND hour = {hour}"
    else:
        sql = f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND date = '{date}'"
    execute_d1_sql(sql)

def insert_rt_aggregation_to_d1(df, table_name, provider, date):
    """Insert RT aggregation DataFrame into D1 table."""
    if df.empty:
        return
    
    # Add provider_key and date if not present
    df = df.copy()
    if 'provider_key' not in df.columns:
        df['provider_key'] = provider
    if 'date' not in df.columns:
        df['date'] = date
    
    # Handle hour column for hourly tables
    if 'hour' in df.columns and 'hour_str' in df.columns:
        # Extract hour from hour_str (format: YYYY-MM-DD-HH)
        df['hour'] = df['hour_str'].apply(lambda x: int(x.split('-')[-1]) if isinstance(x, str) else None)
    
    # Clear old data for each unique hour (if hourly) or for the date (if daily)
    if 'hour' in df.columns:
        for hour in df['hour'].unique():
            if pd.notna(hour):
                clear_old_d1_rt_data(provider, date, table_name, hour=int(hour))
    else:
        clear_old_d1_rt_data(provider, date, table_name)
    
    # Prepare batch insert
    chunk_size = 100
    total_rows = len(df)
    columns = list(df.columns)
    
    for chunk_start in range(0, total_rows, chunk_size):
        chunk = df.iloc[chunk_start:chunk_start + chunk_size]
        
        values_list = []
        for _, row in chunk.iterrows():
            values = []
            for col in columns:
                val = row[col]
                if val is None or (isinstance(val, float) and pd.isna(val)):
                    values.append("NULL")
                elif isinstance(val, str):
                    val_escaped = val.replace("'", "''")
                    values.append(f"'{val_escaped}'")
                elif isinstance(val, (int, float)):
                    values.append(str(val))
                else:
                    val_escaped = str(val).replace("'", "''")
                    values.append(f"'{val_escaped}'")
            values_list.append(f"({', '.join(values)})")
        
        if values_list:
            cols_str = ', '.join(columns)
            values_str = ', '.join(values_list)
            sql = f"INSERT INTO {table_name} ({cols_str}) VALUES {values_str}"
            
            try:
                execute_d1_sql(sql)
                print(f"[d1] Successfully inserted chunk {chunk_start//chunk_size + 1} into {table_name}", flush=True)
            except Exception as e:
                print(f"[d1] Error inserting chunk into {table_name}: {e}", file=sys.stderr, flush=True)
                # Try single-row inserts as fallback for this chunk
                print(f"[d1] Attempting single-row inserts for failed chunk...", flush=True)
                for idx, row in chunk.iterrows():
                    try:
                        single_values = []
                        for col in columns:
                            val = row[col]
                            if val is None or (isinstance(val, float) and pd.isna(val)):
                                single_values.append("NULL")
                            elif isinstance(val, str):
                                val_escaped = val.replace("'", "''")
                                single_values.append(f"'{val_escaped}'")
                            elif isinstance(val, (int, float)):
                                single_values.append(str(val))
                            else:
                                val_escaped = str(val).replace("'", "''")
                                single_values.append(f"'{val_escaped}'")
                        single_sql = f"INSERT INTO {table_name} ({cols_str}) VALUES ({', '.join(single_values)})"
                        execute_d1_sql(single_sql)
                    except Exception as single_e:
                        print(f"[d1] Failed to insert single row into {table_name}: {single_e}", file=sys.stderr, flush=True)
    
    print(f"[d1] Completed insertion attempt for {total_rows} rows into {table_name}", flush=True)


def process_feed_kind(provider, feed_kind, date):
    """Process all files for a specific feed kind and date."""
    prefix = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/"
    objects = list_objects(BRONZE_BUCKET, prefix)
    
    if not objects:
        print(f"[silver-rt] No files found for {prefix}", flush=True)
        return {"hourly": 0, "daily": 0, "files_processed": 0}
    
    all_trip_updates = []
    all_vehicle_positions = []
    
    # Parse all protobuf files
    for obj in objects:
        key = obj["Key"]
        if not key.endswith(".pb"):
            continue
        
        # Extract timestamp from filename
        filename = key.split("/")[-1]
        try:
            # Filename format: {feed_kind}_{YYYY-MM-DDTHH-MM-SS}.pb
            ts_str = filename.replace(f"{feed_kind}_", "").replace(".pb", "")
            # Convert to timestamp (approximate)
            dt = datetime.strptime(ts_str, "%Y-%m-%dT%H-%M-%S").replace(tzinfo=MONTREAL_TZ)
            file_timestamp = int(dt.timestamp())
        except:
            file_timestamp = int(obj.get("LastModified", datetime.now()).timestamp())
        
        feed = parse_protobuf_file(BRONZE_BUCKET, key)
        if not feed:
            continue
        
        if feed_kind == "gtfsrt_trip_updates":
            records = extract_trip_updates(feed, file_timestamp)
            all_trip_updates.extend(records)
        elif feed_kind == "gtfsrt_vehicle_positions":
            records = extract_vehicle_positions(feed, file_timestamp)
            all_vehicle_positions.extend(records)
    
    hourly_count = 0
    daily_count = 0
    
    # Process trip updates
    if all_trip_updates:
        df_tu = pd.DataFrame(all_trip_updates)
        df_tu['file_timestamp'] = pd.to_datetime(df_tu['file_timestamp'], unit='s', errors='coerce')
        
        # Hourly aggregation for Parquet (existing logic)
        df_hourly = aggregate_hourly(df_tu)
        if not df_hourly.empty:
            for _, row in df_hourly.iterrows():
                hour_str = row["hour_str"]
                key = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/rt_{feed_kind}_hourly_{hour_str}.parquet"
                if upload_parquet(SILVER_BUCKET, key, df_hourly[df_hourly["hour_str"] == hour_str]):
                    hourly_count += 1
            
            # D1 aggregation: group by route_id, stop_id, trip_id, hour
            df_tu['hour'] = df_tu['file_timestamp'].dt.hour
            # Fill NaN values with empty string for grouping
            df_tu_clean = df_tu.fillna({'route_id': '', 'stop_id': '', 'trip_id': ''})
            df_d1_hourly = df_tu_clean.groupby(['route_id', 'stop_id', 'trip_id', 'hour'], dropna=False).agg({
                'arrival_delay': ['mean', 'max', 'min'],
                'departure_delay': ['mean', 'max', 'min'],
                'trip_id': 'count',
                'route_id': 'nunique',
                'stop_id': 'nunique'
            }).reset_index()
            df_d1_hourly.columns = ['route_id', 'stop_id', 'trip_id', 'hour', 'avg_arrival_delay', 'max_arrival_delay', 'min_arrival_delay', 'avg_departure_delay', 'max_departure_delay', 'min_departure_delay', 'trip_count', 'route_count', 'stop_count']
            # Replace empty strings back to None for D1
            df_d1_hourly = df_d1_hourly.replace('', None)
            
            # Load into D1
            try:
                insert_rt_aggregation_to_d1(df_d1_hourly, 'rt_delays_hourly', provider, date)
            except Exception as e:
                print(f"[d1] Failed to load hourly delays into D1: {e}", file=sys.stderr, flush=True)
        
        # Daily aggregation for Parquet (existing logic)
        df_daily = aggregate_daily(df_tu)
        if not df_daily.empty:
            key = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/rt_{feed_kind}_daily_{date}.parquet"
            if upload_parquet(SILVER_BUCKET, key, df_daily):
                daily_count += 1
            
            # D1 aggregation: group by route_id, stop_id, trip_id
            df_tu_clean = df_tu.fillna({'route_id': '', 'stop_id': '', 'trip_id': ''})
            df_d1_daily = df_tu_clean.groupby(['route_id', 'stop_id', 'trip_id'], dropna=False).agg({
                'arrival_delay': ['mean', 'max', 'min'],
                'departure_delay': ['mean', 'max', 'min'],
                'trip_id': 'count',
                'route_id': 'nunique',
                'stop_id': 'nunique'
            }).reset_index()
            df_d1_daily.columns = ['route_id', 'stop_id', 'trip_id', 'avg_arrival_delay', 'max_arrival_delay', 'min_arrival_delay', 'avg_departure_delay', 'max_departure_delay', 'min_departure_delay', 'trip_count', 'route_count', 'stop_count']
            # Replace empty strings back to None for D1
            df_d1_daily = df_d1_daily.replace('', None)
            
            # Load into D1
            try:
                insert_rt_aggregation_to_d1(df_d1_daily, 'rt_delays_daily', provider, date)
            except Exception as e:
                print(f"[d1] Failed to load daily delays into D1: {e}", file=sys.stderr, flush=True)
    
    # Process vehicle positions
    if all_vehicle_positions:
        df_vp = pd.DataFrame(all_vehicle_positions)
        df_vp['file_timestamp'] = pd.to_datetime(df_vp['file_timestamp'], unit='s', errors='coerce')
        
        # Hourly aggregation for Parquet (existing logic)
        df_hourly = aggregate_hourly(df_vp)
        if not df_hourly.empty:
            for _, row in df_hourly.iterrows():
                hour_str = row["hour_str"]
                key = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/rt_{feed_kind}_hourly_{hour_str}.parquet"
                if upload_parquet(SILVER_BUCKET, key, df_hourly[df_hourly["hour_str"] == hour_str]):
                    hourly_count += 1
            
            # D1 aggregation: group by route_id, vehicle_id, trip_id, hour
            df_vp['hour'] = df_vp['file_timestamp'].dt.hour
            df_vp_clean = df_vp.fillna({'route_id': '', 'vehicle_id': '', 'trip_id': ''})
            df_d1_hourly = df_vp_clean.groupby(['route_id', 'vehicle_id', 'trip_id', 'hour'], dropna=False).agg({
                'latitude': 'mean',
                'longitude': 'mean',
                'bearing': 'mean',
                'speed': ['mean', 'max'],
                'vehicle_id': 'count',
                'route_id': 'nunique'
            }).reset_index()
            df_d1_hourly.columns = ['route_id', 'vehicle_id', 'trip_id', 'hour', 'avg_latitude', 'avg_longitude', 'avg_bearing', 'avg_speed', 'max_speed', 'vehicle_count', 'route_count']
            # Replace empty strings back to None for D1
            df_d1_hourly = df_d1_hourly.replace('', None)
            
            # Load into D1
            try:
                insert_rt_aggregation_to_d1(df_d1_hourly, 'rt_positions_hourly', provider, date)
            except Exception as e:
                print(f"[d1] Failed to load hourly positions into D1: {e}", file=sys.stderr, flush=True)
        
        # Daily aggregation for Parquet (existing logic)
        df_daily = aggregate_daily(df_vp)
        if not df_daily.empty:
            key = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/rt_{feed_kind}_daily_{date}.parquet"
            if upload_parquet(SILVER_BUCKET, key, df_daily):
                daily_count += 1
            
            # D1 aggregation: group by route_id, vehicle_id, trip_id
            df_vp_clean = df_vp.fillna({'route_id': '', 'vehicle_id': '', 'trip_id': ''})
            df_d1_daily = df_vp_clean.groupby(['route_id', 'vehicle_id', 'trip_id'], dropna=False).agg({
                'latitude': 'mean',
                'longitude': 'mean',
                'bearing': 'mean',
                'speed': ['mean', 'max'],
                'vehicle_id': 'count',
                'route_id': 'nunique'
            }).reset_index()
            df_d1_daily.columns = ['route_id', 'vehicle_id', 'trip_id', 'avg_latitude', 'avg_longitude', 'avg_bearing', 'avg_speed', 'max_speed', 'vehicle_count', 'route_count']
            # Replace empty strings back to None for D1
            df_d1_daily = df_d1_daily.replace('', None)
            
            # Load into D1
            try:
                insert_rt_aggregation_to_d1(df_d1_daily, 'rt_positions_daily', provider, date)
            except Exception as e:
                print(f"[d1] Failed to load daily positions into D1: {e}", file=sys.stderr, flush=True)
    
    return {
        "hourly": hourly_count,
        "daily": daily_count,
        "files_processed": len([o for o in objects if o["Key"].endswith(".pb")])
    }


def main():
    """Main ETL process."""
    dates = get_historical_dates(PROVIDER)
    
    if not dates:
        print("[silver-rt] No historical dates to process", flush=True)
        return
    
    # Determine feed kinds to process
    feed_kinds = []
    if FEED_KIND:
        feed_kinds = [FEED_KIND]
    else:
        # Process both feed kinds
        feed_kinds = ["gtfsrt_trip_updates", "gtfsrt_vehicle_positions"]
    
    total_stats = {"hourly": 0, "daily": 0, "files_processed": 0}
    
    for date in dates:
        print(f"[silver-rt] Processing date: {date}", flush=True)
        
        for feed_kind in feed_kinds:
            print(f"[silver-rt] Processing {feed_kind} for {date}", flush=True)
            stats = process_feed_kind(PROVIDER, feed_kind, date)
            total_stats["hourly"] += stats["hourly"]
            total_stats["daily"] += stats["daily"]
            total_stats["files_processed"] += stats["files_processed"]
    
    print(f"[silver-rt] Completed: {total_stats}", flush=True)
    
    # Log completion
    if WORKER_LOG_URL and WORKER_LOG_SECRET:
        detail = {
            "stage": "silver-rt",
            "provider_key": PROVIDER,
            "dates_processed": dates,
            "feed_kinds": feed_kinds,
            "stats": total_stats,
            "bronze_bucket": BRONZE_BUCKET,
            "silver_bucket": SILVER_BUCKET,
        }
        try:
            headers = {"Content-Type": "application/json", "X-Log-Secret": WORKER_LOG_SECRET}
            payload = {
                "level": "INFO",
                "message": f"Silver RT aggregation completed for {PROVIDER}",
                "provider_key": PROVIDER,
                "feed_id": f"{PROVIDER}_gtfs_rt_historical",
                "detail": detail
            }
            requests.post(WORKER_LOG_URL, headers=headers, data=json.dumps(payload), timeout=15)
        except Exception as e:
            print(f"[silver-rt] log post failed: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()

