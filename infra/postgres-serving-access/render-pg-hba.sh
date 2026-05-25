#!/usr/bin/env bash
set -euo pipefail

database="${POSTGRES_DB:-transit}"
app_role="${POSTGRES_USER:-transit}"
reporting_role="${TRANSIT_REPORTING_ROLE:-transit-reporting}"
db_role="${TRANSIT_DB_ROLE:-transit-db}"
db_public_mode="${TRANSIT_DB_PUBLIC_MODE:-ssh}"

validate_hba_identifier() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || [[ "${value,,}" == "all" ]]; then
    printf 'invalid %s: %q\n' "$name" "$value" >&2
    exit 64
  fi
}

if [[ "$db_public_mode" != "ssh" && "$db_public_mode" != "allow" ]]; then
  printf 'invalid TRANSIT_DB_PUBLIC_MODE: %q\n' "$db_public_mode" >&2
  exit 64
fi

validate_hba_identifier "POSTGRES_DB" "$database"
validate_hba_identifier "POSTGRES_USER" "$app_role"
validate_hba_identifier "TRANSIT_REPORTING_ROLE" "$reporting_role"
validate_hba_identifier "TRANSIT_DB_ROLE" "$db_role"

cat <<HBA
# Managed by Transit slice-8.5. Public TCP is limited to TLS + app owner/reporting.
# transit-db is SSH-tunnel first unless TRANSIT_DB_PUBLIC_MODE=allow is set deliberately.
# TYPE      DATABASE      USER                ADDRESS         METHOD
local       all           all                                 scram-sha-256
host        all           all                 127.0.0.1/32    scram-sha-256
host        all           all                 ::1/128         scram-sha-256
host        all           ${app_role}         172.16.0.0/12   scram-sha-256
host        all           ${app_role}         10.0.0.0/8      scram-sha-256
host        all           ${app_role}         192.168.0.0/16  scram-sha-256
hostssl     ${database}   ${app_role}         0.0.0.0/0       scram-sha-256
hostssl     ${database}   ${app_role}         ::/0            scram-sha-256
hostssl     ${database}   ${reporting_role}   0.0.0.0/0       scram-sha-256
hostssl     ${database}   ${reporting_role}   ::/0            scram-sha-256
hostssl     ${database}   ${db_role}          127.0.0.1/32    scram-sha-256
hostssl     ${database}   ${db_role}          ::1/128         scram-sha-256
hostssl     ${database}   ${db_role}          172.16.0.0/12   scram-sha-256
HBA

if [[ "$db_public_mode" == "allow" ]]; then
  cat <<HBA
hostssl     ${database}   ${db_role}          0.0.0.0/0       scram-sha-256
hostssl     ${database}   ${db_role}          ::/0            scram-sha-256
HBA
fi

cat <<HBA
hostnossl   all           all                 0.0.0.0/0       reject
hostnossl   all           all                 ::/0            reject
hostssl     all           all                 0.0.0.0/0       reject
hostssl     all           all                 ::/0            reject
host        all           all                 0.0.0.0/0       reject
host        all           all                 ::/0            reject
HBA
