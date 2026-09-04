from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from transit_ops.db.migration_guard import assert_explicit_remote_url
from transit_ops.settings import get_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = None


def _get_url() -> str:
    url = config.get_main_option("sqlalchemy.url")
    if not url:
        settings = get_settings()
        url = settings.sqlalchemy_database_url
    if not url:
        raise RuntimeError(
            "No database URL configured. Set DATABASE_URL in .env or sqlalchemy.url in alembic.ini."
        )
    assert_explicit_remote_url(url, os.environ)
    return url


def run_migrations_offline(url: str) -> None:
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        transaction_per_migration=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online(url: str) -> None:
    connectable = create_engine(url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        # transaction_per_migration: each migration commits in its own
        # transaction so a long chain against prod is resumable from the failed
        # step instead of rolling the whole chain back (wave-2 deploy hardening).
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


database_url = _get_url()
if context.is_offline_mode():
    run_migrations_offline(database_url)
else:
    run_migrations_online(database_url)
