#!/usr/bin/env bash

DATABASE_COMPUTE_ADAPTER_NAME="none"

pause_database_compute() {
  echo "[3/3] Handing database compute to adapter '$(database_compute_adapter_name)'..."
  echo "      Database compute is managed by the local/VM host; no external compute API call needed."
}

resume_database_compute() {
  echo "[3/3] Handing database compute to adapter '$(database_compute_adapter_name)'..."
  echo "      Database compute is managed by the local/VM host; no external compute API call needed."
}
