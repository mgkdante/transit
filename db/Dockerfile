FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir uv

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
