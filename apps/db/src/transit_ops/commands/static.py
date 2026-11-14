import os
import tempfile
from pathlib import Path
from typing import Annotated

import typer
from sqlalchemy import text

from transit_ops.db.connection import make_engine
from transit_ops.settings import get_settings
from transit_ops.static.alert_seed import read_alert_seed

app = typer.Typer(help="Static storage tools.")


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context) -> None:
    typer.echo(ctx.get_help())


@app.command('export-alert-seed')
def export_alert_seed(
    provider: Annotated[str, typer.Option('--provider')],
    out: Annotated[Path, typer.Option('--out')],
    statement_timeout_s: Annotated[int, typer.Option('--statement-timeout-s', min=1, max=300)],
) -> None:
    engine = make_engine(get_settings())
    try:
        with engine.connect() as pg, pg.begin():
            pg.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            pg.execute(text("SET LOCAL lock_timeout = '1s'"))
            pg.execute(text(f"SET LOCAL statement_timeout = '{statement_timeout_s}s'"))
            pg.execute(text('SET LOCAL max_parallel_workers_per_gather = 0'))
            payload = read_alert_seed(pg, provider_id=provider).to_json()
    finally:
        engine.dispose()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=out.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, out)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
