"""Read-only, consistent PostgreSQL export for present-state alert cutover."""

from sqlalchemy import Connection, text

from transit_ops.static.alert_seed_contract import (
    TABLES,
    SeedTable,
    canonical_json,
    encode_seed_value,
)
from transit_ops.static.alert_seed_contract import AlertSeed as AlertSeed
from transit_ops.static.alert_seed_contract import AlertSeedInvalid as AlertSeedInvalid


class AlertSeedReadRefused(ValueError):
    pass


def read_alert_seed(pg: Connection, *, provider_id: str) -> AlertSeed:
    if (
        not pg.in_transaction()
        or getattr(pg.connection.driver_connection, "autocommit", True) is not False
    ):
        raise AlertSeedReadRefused("caller must hold a transaction")
    mode = pg.execute(
        text(
            "SELECT current_setting('transaction_read_only'), "
            "current_setting('transaction_isolation')"
        )
    ).one()
    if tuple(mode) != ("on", "repeatable read"):
        raise AlertSeedReadRefused("requires READ ONLY REPEATABLE READ")
    tables = {}
    active = "SELECT * FROM silver.i3_alerts WHERE provider_id=:p AND valid_to IS NULL"
    refs = (
        f"WITH active AS ({active}) SELECT i3_alert_snapshot_id FROM active "
        "UNION SELECT message_snapshot_id FROM active"
    )
    for name in TABLES:
        tables[name] = _read_table(pg, name, provider_id, active, refs)
    try:
        return AlertSeed(
            version=1,
            provider_id=provider_id,
            tables=tables,
            snapshot_at=pg.execute(text("SELECT transaction_timestamp()")).scalar_one(),
            global_max_snapshot_id=pg.execute(
                text("SELECT max(i3_alert_snapshot_id) FROM raw.i3_alert_snapshots")
            ).scalar_one(),
        )
    except (ValueError, KeyError, TypeError) as exc:
        raise AlertSeedInvalid(str(exc)) from exc


def _read_table(pg: Connection, name: str, provider_id: str, active: str, refs: str) -> SeedTable:

    columns = dict(
        pg.execute(
            text(
                "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute "
                "WHERE attrelid=CAST(:name AS regclass) AND attnum>0 AND NOT attisdropped "
                "ORDER BY attnum"
            ),
            {"name": name},
        )
        .tuples()
        .all()
    )
    projection = ", ".join(
        f't."{c}"::text AS "{c}"' if k == "jsonb" else f't."{c}"' for c, k in columns.items()
    )
    if name in TABLES[1:3]:
        where = (
            f"EXISTS (SELECT 1 FROM ({active}) a WHERE "
            "(a.i3_alert_snapshot_id, a.alert_index) = (t.i3_alert_snapshot_id, t.alert_index))"
        )
    elif name == TABLES[5]:
        where = f"t.i3_alert_snapshot_id IN ({refs})"
    else:
        where = "t.provider_id=:p" + (" AND t.valid_to IS NULL" if name == TABLES[0] else "")
    rows = [
        {c: encode_seed_value(v) for c, v in r.items()}
        for r in pg.execute(
            text(f"SELECT {projection} FROM {name} t WHERE {where}"), {"p": provider_id}
        ).mappings()
    ]
    return SeedTable(columns=columns, rows=sorted(rows, key=canonical_json))
