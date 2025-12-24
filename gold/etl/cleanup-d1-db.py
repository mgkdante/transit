#!/usr/bin/env python3
"""
Standalone script to cleanup D1 database.
Can clear all data or provider-specific data.
"""
import os
import sys
import subprocess

D1_DATABASE_NAME = os.getenv("D1_DATABASE_NAME", "transit-bronze")
D1_DATABASE_ID = os.getenv("D1_DATABASE_ID", "7fc37116-50c7-4c5f-bf6b-6c9a958b0140")
PROVIDER = os.getenv("PROVIDER_KEY", "stm")

def execute_d1_sql(sql):
    """Execute SQL on D1 database using wrangler CLI."""
    try:
        import platform
        # Use npx.cmd on Windows, npx on Unix
        npx_cmd = "npx.cmd" if platform.system() == "Windows" else "npx"
        cmd = [npx_cmd, "wrangler", "d1", "execute", D1_DATABASE_NAME, "--command", sql, "--remote"]
        # Use utf-8 encoding to handle wrangler's colored output
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, shell=False, encoding='utf-8', errors='replace')
        return result.stdout
    except subprocess.CalledProcessError as e:
        # Try to decode stderr with utf-8, fallback to errors='replace'
        stderr_msg = e.stderr if isinstance(e.stderr, str) else e.stderr.decode('utf-8', errors='replace')
        print(f"[d1] Error executing SQL: {stderr_msg}", file=sys.stderr, flush=True)
        raise
    except FileNotFoundError as e:
        print(f"[d1] Error: Could not find wrangler. Make sure npx is in your PATH. Error: {e}", file=sys.stderr, flush=True)
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

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Cleanup D1 database")
    parser.add_argument("--provider", type=str, default=None, help="Provider to clean (default: all)")
    parser.add_argument("--all", action="store_true", help="Clean all data (ignore provider)")
    
    args = parser.parse_args()
    
    provider = None if args.all else (args.provider or PROVIDER)
    cleanup_all_d1_data(provider=provider)

