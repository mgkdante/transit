#!/usr/bin/env python3
"""
Gold ETL Script: Load RT aggregation Parquet files from Silver bucket into D1 database.
This script reads RT aggregation Parquet files created by the Silver RT ETL and loads them into D1 for Gold API access.
"""
import os
import io
import sys
import json
import tempfile
import subprocess
from datetime import datetime, timedelta

import pandas as pd
import boto3
import requests

# ---------- Config (env) ----------
ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
SILVER_BUCKET = os.environ["R2_SILVER_BUCKET"]  # e.g. transit-silver
PROVIDER = os.getenv("PROVIDER_KEY", "stm")
FEED_KIND = os.getenv("FEED_KIND", "")  # optional: gtfsrt_trip_updates or gtfsrt_vehicle_positions
PROCESS_DATE = os.getenv("RT_DATE")  # optional YYYY-MM-DD, defaults to yesterday
WORKER_LOG_URL = os.getenv("WORKER_LOG_URL", "")
WORKER_LOG_SECRET = os.getenv("WORKER_LOG_SECRET", "")
D1_DATABASE_NAME = os.getenv("D1_DATABASE_NAME", "transit-bronze")
D1_DATABASE_ID = os.getenv("D1_DATABASE_ID", "7fc37116-50c7-4c5f-bf6b-6c9a958b0140")
D1_RETENTION_DAYS = int(os.getenv("D1_RETENTION_DAYS", "30"))

ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="auto",
)


def list_objects(bucket, prefix):
    """List all objects with given prefix."""
    resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
    return resp.get("Contents", [])


def get_historical_dates(provider):
    """Get dates to process from Silver bucket Parquet files."""
    if PROCESS_DATE:
        return [PROCESS_DATE]
    
    # Get all dates from Silver bucket
    base = f"gtfs-rt/{provider}/"
    resp = list_objects(SILVER_BUCKET, base)
    dates = set()
    
    for obj in resp:
        parts = obj["Key"].split("/")
        for p in parts:
            if p.startswith("dt="):
                dates.add(p.split("=", 1)[1])
    
    if not dates:
        print(f"[gold-rt] No RT Parquet data found for {provider}", flush=True)
        return []
    
    return sorted(dates)


def execute_d1_sql(sql):
    """Execute SQL on D1 database using wrangler CLI."""
    try:
        cmd = ["npx", "wrangler", "d1", "execute", D1_DATABASE_NAME, "--command", sql, "--remote"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace')
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"[d1] Error executing SQL: {e.stderr}", file=sys.stderr, flush=True)
        raise


def cleanup_all_d1_data(provider=None):
    """Empty all tables in D1 database. If provider is specified, only clear that provider's data."""
    print(f"[d1] Starting database cleanup (provider={provider or 'ALL'})...", flush=True)
    
    # List of all tables
    static_tables = ["agency", "routes", "stops", "trips", "stop_times", 
                     "calendar", "calendar_dates", "shapes", "feed_info"]
    rt_tables = ["rt_delays_hourly", "rt_delays_daily", 
                 "rt_positions_hourly", "rt_positions_daily"]
    all_tables = static_tables + rt_tables
    
    for table_name in all_tables:
        try:
            if provider:
                # Clear only specific provider's data
                sql = f"DELETE FROM {table_name} WHERE provider_key = '{provider}'"
            else:
                # Clear all data
                sql = f"DELETE FROM {table_name}"
            execute_d1_sql(sql)
            print(f"[d1] Cleaned up {table_name} (provider={provider or 'ALL'})", flush=True)
        except Exception as e:
            print(f"[d1] Warning: Could not cleanup {table_name}: {e}", file=sys.stderr, flush=True)
    
    print(f"[d1] Database cleanup completed", flush=True)


def cleanup_old_rt_dates(provider, current_date, retention_days=30):
    """Delete old RT data dates, keeping only the last N days."""
    cutoff_date = (datetime.strptime(current_date, "%Y-%m-%d") - timedelta(days=retention_days)).strftime("%Y-%m-%d")
    
    rt_tables = ["rt_delays_hourly", "rt_delays_daily", 
                 "rt_positions_hourly", "rt_positions_daily"]
    
    for table_name in rt_tables:
        sql = f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND date < '{cutoff_date}'"
        try:
            execute_d1_sql(sql)
            print(f"[d1] Cleaned up old dates from {table_name} (older than {cutoff_date})", flush=True)
        except Exception as e:
            print(f"[d1] Warning: Could not cleanup {table_name}: {e}", file=sys.stderr, flush=True)


def load_rt_parquet_to_d1(parquet_key, table_name, provider, date, tmp_dir):
    """Load RT aggregation Parquet file from Silver bucket into D1 table using file import."""
    print(f"[gold] Loading {table_name} from {parquet_key}...", flush=True)
    
    # Read Parquet file from Silver bucket
    try:
        obj = s3.get_object(Bucket=SILVER_BUCKET, Key=parquet_key)
        df = pd.read_parquet(io.BytesIO(obj["Body"].read()))
    except Exception as e:
        print(f"[gold] Error reading Parquet file {parquet_key}: {e}", file=sys.stderr, flush=True)
        raise
    
    if df.empty:
        print(f"[gold] Skipping {table_name} - empty DataFrame", flush=True)
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
    
    total_rows = len(df)
    columns = list(df.columns)
    
    # Generate SQL file
    sql_file = os.path.join(tmp_dir, f"d1_import_{table_name}_{date}.sql")
    
    try:
        with open(sql_file, 'w', encoding='utf-8') as f:
            # Write DELETE statements for old data
            # For hourly tables, delete by hour; for daily, delete by date
            if 'hour' in df.columns:
                # Delete all hours for this date (will be replaced)
                f.write(f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND date = '{date}';\n")
            else:
                # Delete daily data for this date
                f.write(f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND date = '{date}';\n")
            
            # Write INSERT statement with all VALUES
            f.write(f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES\n")
            
            # Build VALUES for all rows
            values_lines = []
            for idx, row in df.iterrows():
                values = []
                for col in columns:
                    val = row[col]
                    if val is None or (isinstance(val, float) and pd.isna(val)):
                        values.append("NULL")
                    elif isinstance(val, str):
                        # Escape single quotes
                        val_escaped = val.replace("'", "''")
                        values.append(f"'{val_escaped}'")
                    elif isinstance(val, (int, float)):
                        values.append(str(val))
                    else:
                        val_escaped = str(val).replace("'", "''")
                        values.append(f"'{val_escaped}'")
                values_lines.append(f"  ({', '.join(values)})")
            
            # Write all VALUES lines (comma-separated, semicolon at end)
            f.write(",\n".join(values_lines))
            f.write(";\n")
        
        # Check file size (D1 supports up to 5GB, warn if > 4GB)
        file_size = os.path.getsize(sql_file)
        file_size_mb = file_size / (1024 * 1024)
        if file_size > 4 * 1024 * 1024 * 1024:  # 4GB
            print(f"[d1] Warning: SQL file is {file_size_mb:.1f} MB (close to 5GB limit)", flush=True)
        else:
            print(f"[d1] Generated SQL file: {file_size_mb:.1f} MB for {table_name}", flush=True)
        
        # Import using wrangler d1 execute --file
        print(f"[d1] Importing {total_rows} rows into {table_name} via file import...", flush=True)
        cmd = ["npx", "wrangler", "d1", "execute", D1_DATABASE_NAME, "--file", sql_file, "--remote"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace')
        
        print(f"[d1] Completed: Imported {total_rows} rows into {table_name}", flush=True)
        
    except subprocess.CalledProcessError as e:
        print(f"[d1] Error importing {table_name} from file: {e.stderr}", file=sys.stderr, flush=True)
        raise
    except Exception as e:
        print(f"[d1] Failed to generate or import SQL file for {table_name}: {e}", file=sys.stderr, flush=True)
        raise


def process_feed_kind(provider, feed_kind, date, tmp_dir):
    """Process Parquet files for a specific feed kind and date."""
    prefix = f"gtfs-rt/{provider}/{feed_kind}/dt={date}/"
    objects = list_objects(SILVER_BUCKET, prefix)
    
    if not objects:
        print(f"[gold-rt] No Parquet files found for {prefix}", flush=True)
        return {"hourly": 0, "daily": 0}
    
    hourly_count = 0
    daily_count = 0
    
    # Process hourly aggregations
    hourly_prefix = f"{prefix}rt_{feed_kind}_hourly_"
    hourly_files = [obj for obj in objects if obj["Key"].startswith(hourly_prefix) and obj["Key"].endswith(".parquet")]
    
    if hourly_files:
        # Determine table name based on feed_kind
        if feed_kind == "gtfsrt_trip_updates":
            table_name = "rt_delays_hourly"
        elif feed_kind == "gtfsrt_vehicle_positions":
            table_name = "rt_positions_hourly"
        else:
            print(f"[gold-rt] Unknown feed_kind: {feed_kind}", flush=True)
            return {"hourly": 0, "daily": 0}
        
        # Load all hourly files (they should be aggregated by the Silver ETL)
        # For simplicity, we'll process each hourly file separately
        for obj in hourly_files:
            parquet_key = obj["Key"]
            try:
                load_rt_parquet_to_d1(parquet_key, table_name, provider, date, tmp_dir)
                hourly_count += 1
            except Exception as e:
                print(f"[gold-rt] Failed to load hourly data from {parquet_key}: {e}", file=sys.stderr, flush=True)
    
    # Process daily aggregations
    daily_prefix = f"{prefix}rt_{feed_kind}_daily_"
    daily_files = [obj for obj in objects if obj["Key"].startswith(daily_prefix) and obj["Key"].endswith(".parquet")]
    
    if daily_files:
        # Determine table name based on feed_kind
        if feed_kind == "gtfsrt_trip_updates":
            table_name = "rt_delays_daily"
        elif feed_kind == "gtfsrt_vehicle_positions":
            table_name = "rt_positions_daily"
        
        # Load daily file
        for obj in daily_files:
            parquet_key = obj["Key"]
            try:
                load_rt_parquet_to_d1(parquet_key, table_name, provider, date, tmp_dir)
                daily_count += 1
            except Exception as e:
                print(f"[gold-rt] Failed to load daily data from {parquet_key}: {e}", file=sys.stderr, flush=True)
    
    return {"hourly": hourly_count, "daily": daily_count}


def main():
    """Main Gold RT ETL process."""
    # Check if full database cleanup is requested
    if os.getenv("CLEANUP_DB", "").lower() in ("true", "1", "yes"):
        cleanup_all_d1_data(provider=PROVIDER if os.getenv("CLEANUP_DB_PROVIDER_ONLY", "").lower() in ("true", "1", "yes") else None)
        if os.getenv("CLEANUP_DB_EXIT", "").lower() in ("true", "1", "yes"):
            print("[d1] Cleanup completed, exiting as requested", flush=True)
            return
    
    dates = get_historical_dates(PROVIDER)
    
    if not dates:
        print("[gold-rt] No historical dates to process", flush=True)
        return
    
    # Clean up old RT dates before processing (use the latest date if available)
    if dates:
        latest_date = max(dates)
        print(f"[d1] Cleaning up old RT dates (keeping last {D1_RETENTION_DAYS} days)...", flush=True)
        cleanup_old_rt_dates(PROVIDER, latest_date, D1_RETENTION_DAYS)
    
    # Determine feed kinds to process
    feed_kinds = []
    if FEED_KIND:
        feed_kinds = [FEED_KIND]
    else:
        # Process both feed kinds
        feed_kinds = ["gtfsrt_trip_updates", "gtfsrt_vehicle_positions"]
    
    total_stats = {"hourly": 0, "daily": 0}
    
    with tempfile.TemporaryDirectory() as tmp_dir:
        for date in dates:
            print(f"[gold-rt] Processing date: {date}", flush=True)
            
            for feed_kind in feed_kinds:
                print(f"[gold-rt] Processing {feed_kind} for {date}", flush=True)
                stats = process_feed_kind(PROVIDER, feed_kind, date, tmp_dir)
                total_stats["hourly"] += stats["hourly"]
                total_stats["daily"] += stats["daily"]
    
    print(f"[gold-rt] Completed: {total_stats}", flush=True)
    
    # Log completion
    if WORKER_LOG_URL and WORKER_LOG_SECRET:
        detail = {
            "stage": "gold-rt",
            "provider_key": PROVIDER,
            "dates_processed": dates,
            "feed_kinds": feed_kinds,
            "stats": total_stats,
            "silver_bucket": SILVER_BUCKET,
        }
        try:
            headers = {"Content-Type": "application/json", "X-Log-Secret": WORKER_LOG_SECRET}
            payload = {
                "level": "INFO",
                "message": f"Gold RT aggregation loaded for {PROVIDER}",
                "provider_key": PROVIDER,
                "feed_id": f"{PROVIDER}_gtfs_rt_historical",
                "detail": detail
            }
            requests.post(WORKER_LOG_URL, headers=headers, data=json.dumps(payload), timeout=15)
        except Exception as e:
            print(f"[gold-rt] log post failed: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()

