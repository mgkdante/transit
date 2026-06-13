from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from transit_ops.health.checks import run_health_checks
from transit_ops.health.models import ComponentHealthResult, OverallHealthResult

CheckRunner = Callable[[], list[ComponentHealthResult]]
Clock = Callable[[], datetime]


def create_app(
    *,
    check_runner: CheckRunner = run_health_checks,
    clock: Clock | None = None,
) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health/live")
    def health_live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health")
    def health() -> JSONResponse:
        checked_at = (clock or _utc_now)()
        try:
            components = check_runner()
        except Exception as exc:  # noqa: BLE001
            components = [
                ComponentHealthResult(
                    name="health_runner",
                    status="down",
                    message=f"Health check runner failed: {_safe_error(exc)}",
                    checked_at_utc=checked_at,
                )
            ]
        overall = OverallHealthResult.from_components(
            checked_at_utc=checked_at,
            components=components,
        )
        # Public, internet-facing endpoint: emit only the coarse status view.
        # The detailed display_dict() (component messages with raw DB/storage/
        # feed error strings + configured feed URLs) must stay off this surface
        # (audit x-security#4); it remains available for operator tooling/logs.
        return JSONResponse(
            status_code=200 if overall.status == "ok" else 503,
            content=overall.public_dict(),
        )

    return app


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _safe_error(exc: Exception) -> str:
    return str(exc).replace("\n", " ")


app = create_app()
