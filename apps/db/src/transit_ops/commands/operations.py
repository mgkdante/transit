import typer

app = typer.Typer(help="Reserved operations lane; not implemented.")


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context) -> None:
    typer.echo(ctx.get_help())
