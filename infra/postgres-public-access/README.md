# Public PostgreSQL Access

Slice `slice-6.2` added the hardened public PostgreSQL path used for Power BI testing against the Oracle host. Slice `slice-6.4` added the TLS/SCRAM app-owner path required by GitHub-hosted Actions and cut over the `DATABASE_URL` secret.

## Files

- `render-pg-hba.sh` renders the `pg_hba.conf` policy. Public access is `hostssl` only for the app owner and `powerbi_reader`; broad non-TLS and other-role paths reject.
- `harden-powerbi-reader.sql` creates or updates `powerbi_reader`, enforces SCRAM password storage, revokes `PUBLIC` and non-Gold paths, grants Gold `USAGE`/`SELECT`, and grants future Gold table `SELECT`.
- `verify_powerbi_reader.py` verifies the external contract: TLS, current user, Gold read access, non-Gold denial, write denial, temp-table denial, and expected HBA rejection paths.

## Apply Role Hardening

Run the SQL as the database owner or an admin role. Supply the reader password through a secret-safe wrapper; do not put real passwords in shell history.

```bash
psql "$ADMIN_DATABASE_URL" \
  -v database_name=transit \
  -v app_owner=transit \
  -v reader_role=powerbi_reader \
  -v powerbi_reader_password='<secret>' \
  -f infra/postgres-public-access/harden-powerbi-reader.sql
```

The future-table grant is scoped to Gold objects created by `app_owner`. If Gold DDL is created by a different owner, re-run this script or add matching `ALTER DEFAULT PRIVILEGES FOR ROLE ... IN SCHEMA gold` grants for that owner.

## Verification

Build a database URL with a percent-encoded password. Do not interpolate a raw 1Password value into `postgresql://...`; symbols such as `@` can break URL parsing.

```bash
export POWERBI_DATABASE_URL='postgresql://powerbi_reader:<encoded-password>@<host>:5432/transit?sslmode=require'
uv run python infra/postgres-public-access/verify_powerbi_reader.py \
  --database-url-env POWERBI_DATABASE_URL
```

Negative checks:

```bash
export POWERBI_DATABASE_URL_NO_TLS='postgresql://powerbi_reader:<encoded-password>@<host>:5432/transit?sslmode=disable'
uv run python infra/postgres-public-access/verify_powerbi_reader.py \
  --database-url-env POWERBI_DATABASE_URL_NO_TLS \
  --expect-connect-failure

export WRONG_ROLE_DATABASE_URL='postgresql://not_powerbi_reader:bogus@<host>:5432/transit?sslmode=require'
uv run python infra/postgres-public-access/verify_powerbi_reader.py \
  --database-url-env WRONG_ROLE_DATABASE_URL \
  --expect-connect-failure
```
