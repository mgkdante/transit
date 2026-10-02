FROM python:3.12.14-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir "uv==0.11.15"

# pg_dump 16 for backup-database: the compose postgres service runs
# transit-postgres-postgis:16 (PostgreSQL 16 base) and slim Bookworm's stock
# Debian client is 15, which refuses to dump a 16 server — hence pgdg. These
# apt patch packages intentionally float for security servicing; protected CI
# prints the versions resolved into each built runtime image.
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
