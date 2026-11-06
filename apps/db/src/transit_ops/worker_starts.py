"""Best-effort worker startup recorder; importing this module performs no I/O."""
from __future__ import annotations

import logging
import subprocess
import sys
import threading
import time
from collections.abc import Sequence

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logger = logging.getLogger(__name__)


def observe_start(provider_id: str) -> None:
    """Wait at most five seconds for observation, while the OS can schedule us."""
    _observe_command(
        [sys.executable, "-m", "transit_ops.worker_starts", "record", provider_id],
        wait_seconds=5,
    )


def _observe_command(command: Sequence[str], *, wait_seconds: float) -> None:
    deadline = time.monotonic() + wait_seconds
    finished = threading.Event()
    succeeded = [False]

    def own_recorder() -> None:
        # One daemon owns launch, kill and wait/reaping. None of these operations
        # runs on the feed thread, including creation and post-kill cleanup stalls.
        try:
            with subprocess.Popen(command, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL) as child:
                try:
                    succeeded[0] = child.wait(timeout=max(0, deadline - time.monotonic())) == 0
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        except OSError:
            pass  # The feed thread emits one sanitized warning.
        finally:
            finished.set()

    owner = threading.Thread(target=own_recorder, name="worker-start-recorder", daemon=True)
    try:
        owner.start()
        owner.join(timeout=max(0, deadline - time.monotonic()))
    except RuntimeError:
        pass
    if not finished.is_set() or not succeeded[0]:
        logger.warning("Worker startup observation unavailable.")


def recorder_engine(database_url):
    # The one UPSERT commits on the server without a later client COMMIT. A lost
    # response or killed client cannot leave it idle in an open transaction.
    return create_engine(
        database_url, poolclass=NullPool, isolation_level="AUTOCOMMIT",
        connect_args={"connect_timeout": 2,
                      "options": "-c statement_timeout=2000 -c lock_timeout=500"},
    )


def record(engine, provider_id: str) -> bool:
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO core.worker_starts (provider_id, start_count)
                VALUES (:provider_id, 1)
                ON CONFLICT (provider_id) DO UPDATE
                SET start_count = core.worker_starts.start_count + 1,
                    last_started_at_utc = clock_timestamp()
            """), {"provider_id": provider_id})
        return True
    except Exception:  # noqa: BLE001 - telemetry must never block ingestion
        logger.warning("Worker startup observation unavailable; continuing feed cycles.")
        return False


def main() -> int:
    try:
        from transit_ops.ingestion.common import project_root
        from transit_ops.providers import ProviderRegistry
        from transit_ops.settings import Settings

        settings = Settings(_env_file=None)
        provider_id = sys.argv[2]
        registry = ProviderRegistry.from_project_root(
            project_root=project_root(), settings=settings,
        )
        registry.get_provider(provider_id)
        engine = recorder_engine(settings.sqlalchemy_database_url)
        try:
            return 0 if record(engine, provider_id) else 1
        finally:
            engine.dispose()
    except Exception:  # noqa: BLE001 - parent emits one sanitized warning
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
