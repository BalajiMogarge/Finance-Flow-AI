#!/usr/bin/env bash
set -e

# If arguments are passed (e.g. docker run container python -c ...), execute them directly
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "=== Finance Flow AI Backend Container Startup ==="

# Prioritize direct unpooled database connection for DDL migrations
MIGRATION_URL="${DATABASE_URL_DIRECT:-$DATABASE_URL}"

if [ -n "$MIGRATION_URL" ]; then
    echo "Executing Alembic database migrations on configured database..."
    DATABASE_URL_DIRECT="$MIGRATION_URL" DATABASE_URL="$MIGRATION_URL" alembic upgrade head || {
        echo "Warning: Alembic migration encountered an error; proceeding to server start..."
    }
else
    echo "DATABASE_URL not set; executing Alembic migrations on default SQLite database..."
    alembic upgrade head || {
        echo "Warning: Alembic migration encountered an error; proceeding to server start..."
    }
fi

APP_PORT="${PORT:-8000}"
echo "Starting Uvicorn server on 0.0.0.0:$APP_PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$APP_PORT" --workers 1
