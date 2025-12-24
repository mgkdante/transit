#!/usr/bin/env python3
import os, io, sys, json, zipfile, tempfile, subprocess
import pandas as pd
import boto3
import requests

# ---------- Config (env) ----------
ACCOUNT_ID  = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY  = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY  = os.environ["R2_SECRET_ACCESS_KEY"]
BRONZE_BUCKET = os.environ["R2_BUCKET"]        # e.g. transit-bronze
SILVER_BUCKET = os.environ["R2_SILVER_BUCKET"]        # e.g. transit-silver
PROVIDER   = os.getenv("PROVIDER_KEY", "stm")
FEED_ID    = os.getenv("FEED_ID", "stm_gtfs_static")
DATE       = os.getenv("GTFS_DATE")                   # optional YYYY-MM-DD
WORKER_LOG_URL    = os.getenv("WORKER_LOG_URL", "")
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
    resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
    return resp.get("Contents", [])

def get_latest_bronze_key(provider):
    if DATE:
        dt = DATE
    else:
        base = f"gtfs-static/{provider}/"
        resp = list_objects(BRONZE_BUCKET, base)
        dts = set()
        for obj in resp:
            parts = obj["Key"].split("/")
            for p in parts:
                if p.startswith("dt="):
                    dts.add(p.split("=",1)[1])
        if not dts:
            raise RuntimeError("No bronze dt folders found.")
        dt = sorted(dts)[-1]
    key = f"gtfs-static/{provider}/dt={dt}/gtfs_{provider}_{dt}.zip"
    s3.head_object(Bucket=BRONZE_BUCKET, Key=key)  # sanity
    return dt, key

DTYPES = {
    "agency.txt": {"agency_id": "string","agency_name":"string","agency_url":"string","agency_timezone":"string","agency_lang":"string","agency_phone":"string","agency_fare_url":"string","agency_email":"string"},
    "routes.txt": {"route_id":"string","agency_id":"string","route_short_name":"string","route_long_name":"string","route_desc":"string","route_type":"Int64","route_url":"string","route_color":"string","route_text_color":"string"},
    "trips.txt": {"route_id":"string","service_id":"string","trip_id":"string","trip_headsign":"string","trip_short_name":"string","direction_id":"Int64","block_id":"string","shape_id":"string","wheelchair_accessible":"Int64","bikes_allowed":"Int64"},
    "stop_times.txt": {"trip_id":"string","arrival_time":"string","departure_time":"string","stop_id":"string","stop_sequence":"Int64","stop_headsign":"string","pickup_type":"Int64","drop_off_type":"Int64","shape_dist_traveled":"float64","timepoint":"Int64"},
    "stops.txt": {"stop_id":"string","stop_code":"string","stop_name":"string","stop_desc":"string","stop_lat":"float64","stop_lon":"float64","zone_id":"string","stop_url":"string","location_type":"Int64","parent_station":"string","stop_timezone":"string","wheelchair_boarding":"Int64","level_id":"string","platform_code":"string"},
    "calendar.txt": {"service_id":"string","monday":"Int64","tuesday":"Int64","wednesday":"Int64","thursday":"Int64","friday":"Int64","saturday":"Int64","sunday":"Int64","start_date":"string","end_date":"string"},
    "calendar_dates.txt": {"service_id":"string","date":"string","exception_type":"Int64"},
    "shapes.txt": {"shape_id":"string","shape_pt_lat":"float64","shape_pt_lon":"float64","shape_pt_sequence":"Int64","shape_dist_traveled":"float64"},
    "feed_info.txt": {"feed_publisher_name":"string","feed_publisher_url":"string","feed_lang":"string","default_lang":"string","feed_start_date":"string","feed_end_date":"string","feed_version":"string"},
}
PARQUET_ORDER = ["agency.txt","routes.txt","trips.txt","stops.txt","stop_times.txt","calendar.txt","calendar_dates.txt","shapes.txt","feed_info.txt"]

# D1 table schemas (columns that exist in D1, excluding provider_key and feed_date which are added)
D1_TABLE_SCHEMAS = {
    "agency": ["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang", "agency_phone", "agency_fare_url", "agency_email"],
    "routes": ["route_id", "agency_id", "route_short_name", "route_long_name", "route_desc", "route_type", "route_url", "route_color", "route_text_color"],
    "trips": ["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name", "direction_id", "block_id", "shape_id", "wheelchair_accessible", "bikes_allowed"],
    "stops": ["stop_id", "stop_code", "stop_name", "stop_desc", "stop_lat", "stop_lon", "zone_id", "stop_url", "location_type", "parent_station", "stop_timezone", "wheelchair_boarding", "level_id", "platform_code"],
    "stop_times": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "stop_headsign", "pickup_type", "drop_off_type", "shape_dist_traveled", "timepoint"],
    "calendar": ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
    "calendar_dates": ["service_id", "date", "exception_type"],
    "shapes": ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"],
    "feed_info": ["feed_publisher_name", "feed_publisher_url", "feed_lang", "default_lang", "feed_start_date", "feed_end_date", "feed_version"],
}

def read_gtfs_csv(buf, fname):
    dtypes = DTYPES.get(fname, None)
    try:
        df = pd.read_csv(buf, dtype=dtypes, keep_default_na=False, na_values=[], low_memory=False)
    except Exception:
        df = pd.read_csv(buf, keep_default_na=False, na_values=[], low_memory=False)
    df = df.applymap(lambda x: x.strip() if isinstance(x, str) else x)
    return df

def upload_bytes(bucket, key, data: bytes, content_type="application/octet-stream"):
    s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)

def execute_d1_sql(sql, params=None):
    """Execute SQL on D1 database using wrangler CLI."""
    try:
        # Use wrangler d1 execute to run SQL
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

def cleanup_old_feed_dates(provider, current_feed_date, retention_days=30):
    """Delete old feed_dates, keeping only the last N days."""
    from datetime import datetime, timedelta
    
    # Calculate cutoff date
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

def clear_old_d1_data(provider, feed_date, table_name):
    """Clear old data for same provider/date before inserting new data."""
    sql = f"DELETE FROM {table_name} WHERE provider_key = ? AND feed_date = ?"
    # Use parameterized query via wrangler
    execute_d1_sql(f"DELETE FROM {table_name} WHERE provider_key = '{provider}' AND feed_date = '{feed_date}'")

def insert_df_to_d1(df, table_name, provider, feed_date):
    """Insert DataFrame into D1 table using batch inserts."""
    if df.empty:
        return
    
    # Clear old data first
    clear_old_d1_data(provider, feed_date, table_name)
    
    # Filter DataFrame to only include columns that exist in D1 schema
    expected_columns = D1_TABLE_SCHEMAS.get(table_name, [])
    if not expected_columns:
        print(f"[d1] WARNING: No schema defined for table {table_name}, using all columns", flush=True)
        expected_columns = [col for col in df.columns if col not in ['provider_key', 'feed_date']]
    else:
        # Add provider_key and feed_date to expected columns for filtering
        expected_columns_with_meta = expected_columns + ['provider_key', 'feed_date']
        # Filter to only columns that exist in both DataFrame and D1 schema
        available_columns = [col for col in expected_columns_with_meta if col in df.columns]
        missing_columns = [col for col in expected_columns if col not in df.columns]
        if missing_columns:
            print(f"[d1] WARNING: Missing columns in data for {table_name}: {missing_columns}", flush=True)
        extra_columns = [col for col in df.columns if col not in expected_columns_with_meta]
        if extra_columns:
            print(f"[d1] INFO: Filtering out extra columns from {table_name}: {extra_columns}", flush=True)
            # #region agent log
            try:
                import json
                log_data = {
                    "location": "gtfs-to-silver.py:insert_df_to_d1",
                    "message": "filtering_extra_columns",
                    "data": {
                        "table_name": table_name,
                        "extra_columns": extra_columns,
                        "available_columns": available_columns,
                        "original_column_count": len(df.columns),
                        "filtered_column_count": len(available_columns)
                    },
                    "timestamp": int(pd.Timestamp.now().timestamp() * 1000),
                    "sessionId": "debug-session",
                    "runId": "run1",
                    "hypothesisId": "D"
                }
                requests.post('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa', 
                           json=log_data, timeout=0.1)
            except:
                pass
            # #endregion
        df = df[available_columns].copy()
    
    # Add provider_key and feed_date if not already present
    if 'provider_key' not in df.columns:
        df['provider_key'] = provider
    if 'feed_date' not in df.columns:
        df['feed_date'] = feed_date
    
    # Prepare batch insert
    # D1 has a limit on batch size, so we'll do chunks of 100 rows
    chunk_size = 100
    total_rows = len(df)
    columns = list(df.columns)
    
    for chunk_start in range(0, total_rows, chunk_size):
        chunk = df.iloc[chunk_start:chunk_start + chunk_size]
        
        # Build VALUES clause
        values_list = []
        for _, row in chunk.iterrows():
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
                # Continue with next chunk
    
    # Verify insertion by counting rows
    try:
        verify_sql = f"SELECT COUNT(*) as count FROM {table_name} WHERE provider_key = '{provider}' AND feed_date = '{feed_date}'"
        verify_result = execute_d1_sql(verify_sql)
        # Parse the count from wrangler output (JSON format)
        import json
        if verify_result:
            # wrangler outputs JSON, try to parse it
            try:
                # Extract JSON from output
                lines = verify_result.strip().split('\n')
                for line in lines:
                    if line.strip().startswith('[') or line.strip().startswith('{'):
                        data = json.loads(line)
                        if isinstance(data, list) and len(data) > 0:
                            count = data[0].get('results', [{}])[0].get('count', 0)
                            print(f"[d1] Verified: {count} rows in {table_name} for {provider}/{feed_date}", flush=True)
                            if count == 0:
                                print(f"[d1] WARNING: No rows found after insertion attempt!", file=sys.stderr, flush=True)
                            break
            except:
                pass
    except Exception as e:
        print(f"[d1] Could not verify insertion: {e}", file=sys.stderr, flush=True)
    
    print(f"[d1] Completed insertion attempt for {total_rows} rows into {table_name}", flush=True)

def main():
    dt, bronze_key = get_latest_bronze_key(PROVIDER)
    print(f"[silver] Using bronze ZIP: s3://{BRONZE_BUCKET}/{bronze_key}", flush=True)
    
    # Clean up old feed_dates before processing
    print(f"[d1] Cleaning up old feed_dates (keeping last {D1_RETENTION_DAYS} days)...", flush=True)
    cleanup_old_feed_dates(PROVIDER, dt, D1_RETENTION_DAYS)

    obj = s3.get_object(Bucket=BRONZE_BUCKET, Key=bronze_key)
    body = obj["Body"].read()

    import io, tempfile, zipfile
    with tempfile.TemporaryDirectory() as tmp:
        zpath = os.path.join(tmp, "bronze.zip")
        with open(zpath, "wb") as f:
            f.write(body)

        with zipfile.ZipFile(zpath, "r") as zf:
            names = zf.namelist()
            # Since we're in the SILVER bucket, we don't need a "silver/" prefix
            silver_prefix = f"gtfs-static/{PROVIDER}/dt={dt}/"

            manifest = {"provider_key": PROVIDER, "feed_id": FEED_ID, "date": dt, "tables": [], "bucket": SILVER_BUCKET}
            for fname in PARQUET_ORDER:
                if fname not in names:
                    continue
                with zf.open(fname) as fsrc:
                    data = fsrc.read()
                df = read_gtfs_csv(io.BytesIO(data), fname)

                # Create Parquet file (for archive)
                pbuf = io.BytesIO()
                df.to_parquet(pbuf, index=False)
                pbuf.seek(0)

                out_key = silver_prefix + fname.replace(".txt", ".parquet")
                upload_bytes(SILVER_BUCKET, out_key, pbuf.read(), content_type="application/octet-stream")
                manifest["tables"].append({"name": fname, "rows": int(df.shape[0]), "r2_key": out_key})
                
                # Load into D1 database
                table_name = fname.replace(".txt", "")
                try:
                    print(f"[d1] Loading {table_name} into D1...", flush=True)
                    insert_df_to_d1(df, table_name, PROVIDER, dt)
                except Exception as e:
                    print(f"[d1] Failed to load {table_name} into D1: {e}", file=sys.stderr, flush=True)
                    # Continue processing other tables

            mkey = silver_prefix + "manifest.json"
            upload_bytes(SILVER_BUCKET, mkey, json.dumps(manifest, ensure_ascii=False).encode("utf-8"), content_type="application/json")

    # Log back to Worker
    if WORKER_LOG_URL and WORKER_LOG_SECRET:
        detail = {
            "stage": "silver",
            "provider_key": PROVIDER,
            "feed_id": FEED_ID,
            "bronze_bucket": BRONZE_BUCKET,
            "bronze_r2_key": bronze_key,
            "silver_bucket": SILVER_BUCKET,
            "silver_prefix": f"gtfs-static/{PROVIDER}/dt={dt}/",
        }
        try:
            headers = {"Content-Type": "application/json", "X-Log-Secret": WORKER_LOG_SECRET}
            payload = {
                "level": "INFO",
                "message": f"Silver Parquet written for {PROVIDER} {dt}",
                "provider_key": PROVIDER,
                "feed_id": FEED_ID,
                "detail": detail
            }
            requests.post(WORKER_LOG_URL, headers=headers, data=json.dumps(payload), timeout=15)
        except Exception as e:
            print(f"[silver] log post failed: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
