#!/bin/sh

set -e

echo "Starting MetaMCP services..."

# Resolve SQLite file path and ensure its parent directory exists.
# Docker volume names are NOT filesystem paths. Prefer a mount at /data:
#   DATABASE_URL=file:/data/metamcp.db
#   volumes: ["global_metamcp_sqlite_data:/data"]
#
# If only SQLITE_DATABASE_URL=sqlite://<volume_name>/metamcp.db is set
# (common in Ansible templates), rewrite it to file:/data/<basename>.
normalize_database_url() {
    url="${DATABASE_URL:-${SQLITE_DATABASE_URL:-file:/data/metamcp.db}}"

    case "$url" in
        postgres://*|postgresql://*|mysql://*|mariadb://*)
            echo "❌ DATABASE_URL must be a SQLite file URL (e.g. file:/data/metamcp.db), got: $url"
            exit 1
            ;;
        file:*)
            path="${url#file:}"
            ;;
        sqlite://*)
            path="${url#sqlite://}"
            ;;
        sqlite:*)
            path="${url#sqlite:}"
            ;;
        *)
            path="$url"
            ;;
    esac

    # file:///data/foo.db → /data/foo.db
    case "$path" in
        //*) path="${path#/}" ;;
    esac

    # Volume-name style path (no leading / or .) → store under /data
    # e.g. global_metamcp_sqlite_data/metamcp.db → /data/metamcp.db
    case "$path" in
        /*|.*)
            ;;
        */*)
            basename="${path##*/}"
            echo "⚠️  SQLITE path looks like a Docker volume name ($path)."
            echo "   Using /data/$basename instead. Mount your volume at /data."
            path="/data/$basename"
            ;;
    esac

    case "$path" in
        /*) ;;
        *) path="$(pwd)/$path" ;;
    esac

    dir="$(dirname "$path")"
    mkdir -p "$dir"

    export DATABASE_URL="file:$path"
    echo "Using DATABASE_URL=$DATABASE_URL"
}

# Function to run migrations
run_migrations() {
    echo "Running database migrations..."
    cd /app/apps/backend

    normalize_database_url

    # Check if migrations need to be run
    if [ -d "drizzle" ] && [ "$(ls -A drizzle/*.sql 2>/dev/null)" ]; then
        echo "Found migration files, running migrations..."
        # Use local drizzle-kit since env vars are available at system level in Docker
        if pnpm exec drizzle-kit migrate; then
            echo "Migrations completed successfully!"
        else
            echo "❌ Migration failed! Exiting..."
            exit 1
        fi
    else
        echo "No migrations found or directory empty"
    fi

    cd /app
}

# Run migrations
run_migrations

# Start backend in the background
echo "Starting backend server..."
cd /app/apps/backend
# Re-export normalized URL for the Node process (cwd differs from entrypoint start)
normalize_database_url
PORT=12009 node dist/index.js &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Check if backend is still running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Backend server died! Exiting..."
    exit 1
fi
echo "✅ Backend server started successfully (PID: $BACKEND_PID)"

# Start frontend
echo "Starting frontend server..."
cd /app/apps/frontend
PORT=12008 pnpm start &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

# Check if frontend is still running
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Frontend server died! Exiting..."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi
echo "✅ Frontend server started successfully (PID: $FRONTEND_PID)"

# Function to cleanup on exit
cleanup() {
    echo "Shutting down services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID 2>/dev/null || true
    echo "Services stopped"
}

# Trap signals for graceful shutdown
trap cleanup TERM INT

echo "Services started successfully!"
echo "Backend running on port 12009"
echo "Frontend running on port 12008"

# Wait for both processes
wait $BACKEND_PID
wait $FRONTEND_PID
