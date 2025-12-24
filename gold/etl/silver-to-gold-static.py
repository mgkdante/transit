#!/usr/bin/env python3
"""
Gold ETL Script: Load GTFS Static Parquet files from Silver bucket into D1 database.
This script reads Parquet files created by the Silver ETL and loads them into D1 for Gold API access.
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
FEED_ID = os.getenv("FEED_ID", "stm_gtfs_static")
DATE = os.getenv("GTFS_DATE")  # optional YYYY-MM-DD
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


def get_latest_silver_date(provider):
    """Get the latest date from Silver bucket Parquet files."""
    if DATE:
        return DATE
    
    base = f"gtfs-static/{provider}/"
    resp = list_objects(SILVER_BUCKET, base)
    dts = set()
    
    for obj in resp:
        parts = obj["Key"].split("/")
        for p in parts:
            if p.startswith("dt="):
                dts.add(p.split("=", 1)[1])
    
    if not dts:
        raise RuntimeError("No silver dt folders found.")
    
    return sorted(dts)[-1]


def execute_d1_sql(sql):
    """Execute SQL on D1 database using wrangler CLI."""
    try:
        cmd = ["npx", "wrangler", "d1", "execute", D1_DATABASE_NAME, "--command", sql, "--remote"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace')
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"[d1] Error executing SQL: {e.stderr}", file=sys.stderr, flush=True)
        raise


def cleanup_old_feed_dates(provider, current_feed_date, retention_days=30):
    """Delete old feed_dates, keeping only the last N days."""
    cutoff_date = (datetime.strptime(current_feed_date, "%Y-%m-%d") - timedelta(days=retention_days)).strftime("%Y-%m-%d")
    
    # List of static tables that use feed_date
    static_tables = ["agency", "routes", "stops", "trips", "stop_times", 
                     "calendar", "calendar_dates", "shapes", "feed_info"]
    
    for table_name in static_tables:
        sql = f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND feed_date < '{cutoff_date}'"
        try:
            execute_d1_sql(sql)
            print(f"[d1] Cleaned up old feed_dates from {table_name} (older than {cutoff_date})", flush=True)
        except Exception as e:
            print(f"[d1] Warning: Could not cleanup {table_name}: {e}", file=sys.stderr, flush=True)


def load_parquet_to_d1(parquet_key, table_name, provider, feed_date, tmp_dir):
    """Load Parquet file from Silver bucket into D1 table using file import."""
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
    
    # Add provider_key and feed_date to DataFrame
    df = df.copy()
    df['provider_key'] = provider
    df['feed_date'] = feed_date
    
    total_rows = len(df)
    columns = list(df.columns)
    
    # Generate SQL file
    sql_file = os.path.join(tmp_dir, f"d1_import_{table_name}.sql")
    
    try:
        with open(sql_file, 'w', encoding='utf-8') as f:
            # Write DELETE statement for old data (same feed_date)
            f.write(f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND feed_date = '{feed_date}';\n")
            
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


def main():
    """Main Gold ETL process."""
    # Check if full database cleanup is requested
    if os.getenv("CLEANUP_DB", "").lower() in ("true", "1", "yes"):
        cleanup_all_d1_data(provider=PROVIDER if os.getenv("CLEANUP_DB_PROVIDER_ONLY", "").lower() in ("true", "1", "yes") else None)
        if os.getenv("CLEANUP_DB_EXIT", "").lower() in ("true", "1", "yes"):
            print("[d1] Cleanup completed, exiting as requested", flush=True)
            return
    
    dt = get_latest_silver_date(PROVIDER)
    print(f"[gold] Using silver Parquet files for date: {dt}", flush=True)
    
    # Clean up old feed_dates before processing
    print(f"[d1] Cleaning up old feed_dates (keeping last {D1_RETENTION_DAYS} days)...", flush=True)
    cleanup_old_feed_dates(PROVIDER, dt, D1_RETENTION_DAYS)
    
    # List of tables to load (matching Parquet files in Silver)
    tables = ["agency", "routes", "trips", "stops", "stop_times", 
              "calendar", "calendar_dates", "shapes", "feed_info"]
    
    silver_prefix = f"gtfs-static/{PROVIDER}/dt={dt}/"
    
    with tempfile.TemporaryDirectory() as tmp_dir:
        for table_name in tables:
            parquet_key = silver_prefix + f"{table_name}.parquet"
            
            # Check if Parquet file exists
            try:
                s3.head_object(Bucket=SILVER_BUCKET, Key=parquet_key)
            except Exception:
                print(f"[gold] Skipping {table_name} - Parquet file not found: {parquet_key}", flush=True)
                continue
            
            try:
                load_parquet_to_d1(parquet_key, table_name, PROVIDER, dt, tmp_dir)
            except Exception as e:
                print(f"[gold] Failed to load {table_name} into D1: {e}", file=sys.stderr, flush=True)
                # Continue processing other tables
    
    # Log completion
    if WORKER_LOG_URL and WORKER_LOG_SECRET:
        detail = {
            "stage": "gold-static",
            "provider_key": PROVIDER,
            "feed_id": FEED_ID,
            "date": dt,
            "silver_bucket": SILVER_BUCKET,
            "silver_prefix": silver_prefix,
        }
        try:
            headers = {"Content-Type": "application/json", "X-Log-Secret": WORKER_LOG_SECRET}
            payload = {
                "level": "INFO",
                "message": f"Gold static data loaded for {PROVIDER} {dt}",
                "provider_key": PROVIDER,
                "feed_id": FEED_ID,
                "detail": detail
            }
            requests.post(WORKER_LOG_URL, headers=headers, data=json.dumps(payload), timeout=15)
        except Exception as e:
            print(f"[gold] log post failed: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()

