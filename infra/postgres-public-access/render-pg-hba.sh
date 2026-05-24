#!/usr/bin/env bash
set -euo pipefail

database="${POSTGRES_DB:-transit}"
app_role="${POSTGRES_USER:-transit}"
reader_role="${POWERBI_READER_ROLE:-powerbi_reader}"

validate_hba_identifier() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || [[ "${value,,}" == "all" ]]; then
    printf 'invalid %s: %q\n' "$name" "$value" >&2
    exit 64
  fi
}

validate_hba_identifier "POSTGRES_DB" "$database"
validate_hba_identifier "POSTGRES_USER" "$app_role"
validate_hba_identifier "POWERBI_READER_ROLE" "$reader_role"

cat <<HBA
# Managed by Transit slice-6.4. Public TCP is limited to TLS + app owner or powerbi_reader.
# TYPE      DATABASE      USER           ADDRESS         METHOD
local       all           all                            scram-sha-256
host        all           all            127.0.0.1/32    scram-sha-256
host        all           all            ::1/128         scram-sha-256
host        all           ${app_role}    172.16.0.0/12   scram-sha-256
host        all           ${app_role}    10.0.0.0/8      scram-sha-256
host        all           ${app_role}    192.168.0.0/16  scram-sha-256
hostssl     ${database}   ${app_role}    0.0.0.0/0       scram-sha-256
hostssl     ${database}   ${app_role}    ::/0            scram-sha-256
hostssl     ${database}   ${reader_role} 0.0.0.0/0       scram-sha-256
hostssl     ${database}   ${reader_role} ::/0            scram-sha-256
hostnossl   all           all            0.0.0.0/0       reject
hostnossl   all           all            ::/0            reject
hostssl     all           all            0.0.0.0/0       reject
hostssl     all           all            ::/0            reject
host        all           all            0.0.0.0/0       reject
host        all           all            ::/0            reject
HBA
