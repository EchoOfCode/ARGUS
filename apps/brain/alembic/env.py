import os
import shutil
import sys
import time
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Ensure apps/brain is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db import resolve_db_path

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def get_sqlite_url() -> str:
    db_path = resolve_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    normalized = db_path.replace("\\", "/")
    return f"sqlite:///{normalized}"


def backup_database_before_migrate() -> None:
    db_path = resolve_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    if os.path.exists(db_path):
        backup_path = f"{db_path}.bak.{int(time.time())}"
        shutil.copy2(db_path, backup_path)
        print(f"[ALEMBIC] Automated safety backup created: {backup_path}")


def run_migrations_offline() -> None:
    url = get_sqlite_url()
    backup_database_before_migrate()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    backup_database_before_migrate()
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = get_sqlite_url()

    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
