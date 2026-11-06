"""Read-only worker-start probe and migration privilege preflight."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

MARKER = re.compile(r"<!-- worker-start-count:(\d+) -->")
TABLE = "core.worker_starts"


def probe(engine, notify) -> int:
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        # Pre-rollout absence is expected. Permission/connect errors are failures,
        # never treated as an empty table. No GitHub calls before this check.
        access = conn.execute(text("""
            WITH target AS (
                SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'core' AND c.relname = 'worker_starts'
            ), version AS (
                SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = 'alembic_version'
            )
            SELECT current_user AS role, EXISTS (SELECT FROM target) AS present,
                has_schema_privilege(current_user, 'core', 'USAGE') AS core_usage,
                has_schema_privilege(current_user, 'core', 'CREATE') AS core_create,
                has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
                has_table_privilege(current_user, (SELECT oid FROM version), 'SELECT')
                    AS version_select,
                has_table_privilege(current_user, (SELECT oid FROM version), 'UPDATE')
                    AS version_update,
                has_schema_privilege(current_user, 'core', 'USAGE WITH GRANT OPTION')
                    AS core_usage_grant,
                has_schema_privilege(current_user, 'core', 'CREATE') AS new_table_grants,
                (has_schema_privilege(current_user, 'core', 'USAGE') AND
                 has_table_privilege(current_user, (SELECT oid FROM target), 'SELECT')) AS readable
        """)).mappings().one()
        readable = "yes" if access["readable"] else "no"
        fingerprint = hashlib.sha256(access["role"].encode("utf-8")).hexdigest()[:12]
        print(f"Worker start probe: role_sha256={fingerprint} read_access={readable}")
        # CREATE makes this role the new table owner, able to grant its privileges.
        # This is prospective capability evidence, not a DDL/grant execution test.
        keys = ("core_usage", "core_create", "public_usage", "version_select", "version_update",
                "core_usage_grant", "new_table_grants")
        print("Migration preflight: " + json.dumps({key: bool(access[key]) for key in keys}))
        permissions_ok = all(access[key] for key in keys)
        print(f"migration_permissions_ok={str(permissions_ok).lower()}")
        if access["public_usage"] and access["version_select"]:
            revisions = conn.execute(text(
                "SELECT version_num FROM public.alembic_version ORDER BY version_num"
            )).scalars().all()
            print("current_revisions=" + json.dumps(revisions))
        else:
            print("current_revisions=unavailable")
        if not access["present"]:
            print("Worker start probe: table absent; waiting for approved migration/rollout. "
                  "Green probe status does not establish migration readiness or approval.")
            return 0
        if not access["readable"]:
            raise PermissionError(f"Worker start read denied for role_sha256={fingerprint}")
        rows = conn.execute(text(f"SELECT * FROM {TABLE} ORDER BY provider_id")).mappings().all()
    for row in rows:
        notify(dict(row))
    return 0


def _gh(*args: str) -> str:
    return subprocess.run(
        ["gh", *args], check=True, capture_output=True, text=True, timeout=45,
    ).stdout


class AlertChannel:
    def __init__(self):
        self.issues = json.loads(_gh(
            "api", "--paginate", "--slurp",
            f"repos/{os.environ['GH_REPO']}/issues?state=all&labels=worker-restart-alert&per_page=100",
        ))
        self.issues = [issue for page in self.issues for issue in page]

    def notify(self, row: dict) -> None:
        provider = row["provider_id"]
        # These IDs also become label slugs and text; no shell interpolation.
        if not re.fullmatch(r"[a-z0-9_]+", provider):
            raise ValueError("Invalid worker provider ID")
        slug = f"worker-start-{provider}"
        issues = [i for i in self.issues if any(
            label["name"] == f"alert:{slug}" for label in i["labels"]
        )]
        count = int(row["start_count"])
        reported = max((int(m.group(1)) for i in issues
                        for m in MARKER.finditer(i.get("body") or "")), default=0)
        if count <= reported:
            return
        body = (
            f"Worker start observed for {provider}. {count - reported} new start(s); "
            f"cumulative count {count}. Latest observed start: {row['last_started_at_utc']}.\n\n"
            "The cause and exit code are unknown. A deliberate restart or rollout also "
            "triggers this alert. This is startup evidence, not Docker exit evidence.\n\n"
            "Open-issue updates mention @mgkdante but may not email the owner; GitHub "
            "notification preferences and delivery control email receipt. Issues remain "
            "open until manually closed.\n\n"
            f"<!-- worker-start-count:{count} -->"
        )
        opened = next((i for i in issues if i["state"].lower() == "open"), None)
        if opened:
            self.update(opened, body)
        else:
            self.create(slug, body)

    def create(self, slug: str, body: str) -> None:
        script = Path(__file__).resolve().parents[4] / ".github/scripts/alert-issue.sh"
        subprocess.run(
            ["bash", str(script), "fire", slug, "[alert] worker start observed", body],
            env={**os.environ, "ALERT_LABEL": "worker-restart-alert"},
            check=True, capture_output=True, timeout=90,
        )

    def update(self, issue: dict, body: str) -> None:
        number = str(issue["number"])
        _gh("issue", "comment", number, "--body", "@mgkdante\n\n" + body)
        # Preserve owner text. Commit the high-water mark only after notification.
        previous = MARKER.sub("", issue.get("body") or "")
        marker = MARKER.search(body)
        assert marker is not None
        _gh("issue", "edit", number, "--body", previous + "\n" + marker.group(0))


def main() -> int:
    try:
        # No dotenv loading. Both callers inherit their existing DB configuration.
        from transit_ops.settings import Settings

        settings = Settings(_env_file=None)
        engine = create_engine(settings.sqlalchemy_database_url, poolclass=NullPool,
                               connect_args={"connect_timeout": 10, "options":
                                             "-c statement_timeout=5000 -c lock_timeout=500"})
        try:
            # Lazy construction: missing table must produce no issue/API call.
            channel = None

            def notify(row):
                nonlocal channel
                if channel is None:
                    channel = AlertChannel()
                channel.notify(row)

            return probe(engine, notify)
        finally:
            engine.dispose()
    except Exception as exc:  # noqa: BLE001 - class only, never driver message/URL
        print(f"Worker start probe failed: {type(exc).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
