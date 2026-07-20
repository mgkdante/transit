# transit-ops

Python 3.12 data pipeline for Transit. This package captures STM source feeds,
preserves Bronze artifacts, normalizes Silver tables, builds Gold marts, and
publishes the versioned public snapshot consumed by the edge and web domains.

Run commands from `apps/db`:

```bash
uv sync --frozen
uv run ruff check .
uv run pytest
uv run transit-ops --help
```

Configuration is environment-driven. Start from the repository root
`.env.example` and provide only the variables required by the path you run.

## Existing Postgres volumes

`POSTGRES_PASSWORD` initializes only an empty Postgres data directory. Changing
the environment value does not rotate the database role password stored in an
existing volume.

For disposable local data, stop the stack, confirm the data can be lost, and
remove only the Compose `postgres_data` volume before recreating it. Volume
removal is destructive; never use that path for retained or production data.

For retained data, obtain owner approval and rotate in this order:

1. Read the new secret into the current shell without putting it in shell
   history:

   ```bash
   read -rsp 'New Postgres password: ' POSTGRES_PASSWORD
   export POSTGRES_PASSWORD
   printf '\n'
   ```

   This satisfies the Compose parser only. No service is recreated before the database role changes.
2. Stop database clients while leaving Postgres running:

   ```bash
   docker compose stop worker pruner health
   ```

3. Open the database shell, enter the current password, and rotate the role:

   ```bash
   docker compose exec postgres psql -U "${POSTGRES_USER:-transit}" -d "${POSTGRES_DB:-transit}"
   \password
   ```

4. Persist the same `POSTGRES_PASSWORD` in the runtime secret source.
5. Recreate the services without deleting `postgres_data`:

   ```bash
   docker compose up -d --force-recreate postgres worker pruner health
   ```

6. Verify the new credential through the health and worker paths. The old password must fail.
   Retain the private-bind, network, firewall, and HBA receipts.

Production rotation, recreation, and restart remain owner-gated.

## Retention defaults

- Static dataset count: 1
- Bronze raw static and alerts: 30 days
- Bronze raw realtime: 90 days
- Silver realtime: 1 day
- Gold detail facts 14 days
- Gold aggregate and reporting marts: 730 days

`.env.example` is the executable configuration reference. A retention change
must update settings, environment examples, tests, and this list together.
