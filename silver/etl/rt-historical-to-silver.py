#!/usr/bin/env python3
"""
RT Historical ETL Script
Processes GTFS-RT protobuf files older than 24 hours from Bronze bucket.
Aggregates data hourly and daily, outputs Parquet files to Silver bucket.
"""
import os
import io
import sys
import json
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
            
        
        # Daily aggregation for Parquet (existing logic)
        df_daily = aggregate_daily(df_tu)
        if not df_daily.empty:
            key = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/rt_{feed_kind}_daily_{date}.parquet"
            if upload_parquet(SILVER_BUCKET, key, df_daily):
                daily_count += 1
            
    
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
            
        
        # Daily aggregation for Parquet (existing logic)
        df_daily = aggregate_daily(df_vp)
        if not df_daily.empty:
            key = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/rt_{feed_kind}_daily_{date}.parquet"
            if upload_parquet(SILVER_BUCKET, key, df_daily):
                daily_count += 1
            
    
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

