# PostgreSQL Serving Access

This directory defines two external SQL-role contracts.

- `transit-reporting`: Gold-only reporting reader for the /v1 snapshot publisher and `transit.yesid.dev`.
- `transit-db`: SQL developer reader for operator analysis. It can read `raw`, `core`, `silver`, and `gold`, and it can create temporary tables. It cannot write permanent objects.

Both contracts require SCRAM passwords and TLS. `transit-db` is SSH-tunnel first by default; public HBA exposure must be turned on deliberately with `TRANSIT_DB_PUBLIC_MODE=allow`.

## Apply HBA

```bash
bash infra/postgres-serving-access/render-pg-hba.sh
```

## Apply Role Hardening

Run as database owner/admin. Pass passwords through a secret-safe wrapper.

```bash
psql "$ADMIN_DATABASE_URL" \
  -v database_name=transit \
  -v app_owner=transit \
  -v reporting_role=transit-reporting \
  -v db_role=transit-db \
  -v transit_reporting_password='<secret>' \
  -v transit_db_password='<secret>' \
  -f infra/postgres-serving-access/harden-sql-readers.sql
```

## Verification

```bash
export TRANSIT_REPORTING_DATABASE_URL='postgresql://transit-reporting:<encoded-password>@<host>:5432/transit?sslmode=require'
uv run python infra/postgres-serving-access/verify_sql_readers.py \
  --database-url-env TRANSIT_REPORTING_DATABASE_URL \
  --expected-user transit-reporting \
  --role-contract reporting

export TRANSIT_DB_DATABASE_URL='postgresql://transit-db:<encoded-password>@localhost:5432/transit?sslmode=require'
uv run python infra/postgres-serving-access/verify_sql_readers.py \
  --database-url-env TRANSIT_DB_DATABASE_URL \
  --expected-user transit-db \
  --role-contract db
```

The proof must show current user, TLS, allowed schema reads, denied forbidden schemas, denied writes, and the correct temporary-table behavior for each role.
