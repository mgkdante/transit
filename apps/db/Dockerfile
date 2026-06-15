FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir uv

# pg_dump 16 for backup-database: the compose postgres service runs
# transit-postgres-postgis:16 (postgres:16 base) and slim bookworm's stock
# Debian client is 15, which refuses to dump a 16 server — hence pgdg.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-common ca-certificates \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock alembic.ini ./
COPY config ./config
COPY src ./src

RUN uv sync --locked --no-dev \
    && adduser --disabled-password --gecos "" --home /app appuser \
    && mkdir -p /app/data/bronze \
    && chown -R appuser:appuser /app

USER appuser

ENTRYPOINT ["python", "-m", "transit_ops.cli"]
CMD ["run-realtime-worker", "stm"]
