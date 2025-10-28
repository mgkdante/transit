#!/usr/bin/env python3
import os, io, sys, json, zipfile, tempfile
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

def main():
    dt, bronze_key = get_latest_bronze_key(PROVIDER)
    print(f"[silver] Using bronze ZIP: s3://{BRONZE_BUCKET}/{bronze_key}", flush=True)

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

                pbuf = io.BytesIO()
                df.to_parquet(pbuf, index=False)
                pbuf.seek(0)

                out_key = silver_prefix + fname.replace(".txt", ".parquet")
                upload_bytes(SILVER_BUCKET, out_key, pbuf.read(), content_type="application/octet-stream")
                manifest["tables"].append({"name": fname, "rows": int(df.shape[0]), "r2_key": out_key})

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
