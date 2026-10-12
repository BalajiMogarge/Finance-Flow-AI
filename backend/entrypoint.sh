#!/usr/bin/env bash
set -e

echo "=== Finance Flow AI Backend Container Startup ==="

# Prioritize direct unpooled database connection for DDL migrations
MIGRATION_URL="${DATABASE_URL_DIRECT:-$DATABASE_URL}"

if [ -n "$MIGRATION_URL" ]; then
    echo "Executing Alembic database migrations..."
    DATABASE_URL_DIRECT="$MIGRATION_URL" DATABASE_URL="$MIGRATION_URL" alembic upgrade head || {
        echo "Warning: Alembic migration encountered an error; proceeding to server start..."
    }
else
    echo "DATABASE_URL not set; skipping Alembic migration."
fi

APP_PORT="${PORT:-8000}"
echo "Starting Uvicorn server on 0.0.0.0:$APP_PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$APP_PORT" --workers 1
