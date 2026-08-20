#!/bin/sh

set -e

echo "🚀 Starting MetaMCP development services..."
echo "📁 Working directory: $(pwd)"
echo "🔍 Node version: $(node --version)"
echo "📦 pnpm version: $(pnpm --version)"

# Function to cleanup on exit
cleanup_on_exit() {
    echo "🛑 SHUTDOWN: Received shutdown signal, cleaning up..."
    echo "🛑 SHUTDOWN: Signal received at $(date)"
    
    # Kill the pnpm dev process
    if [ -n "$PNPM_PID" ]; then
        echo "🛑 SHUTDOWN: Killing pnpm dev process (PID: $PNPM_PID)"
        kill -TERM "$PNPM_PID" 2>/dev/null || true
    fi
    
    # Kill any other background processes
    jobs -p | xargs -r kill 2>/dev/null || true
    echo "🛑 SHUTDOWN: Killed background processes"
    
    echo "🛑 SHUTDOWN: Development services stopped"
    exit 0
}

# Setup cleanup trap for multiple signals
trap cleanup_on_exit TERM INT EXIT

echo "🔧 Setting up development environment..."
if [ ! -f .env.local ]; then
    echo "📄 Creating .env.local from example.env"
    cp example.env .env.local
fi
echo "📊 Backend will run on port 12009"
echo "🌐 Frontend will run on port 12008"
echo "🔄 Hot reloading is enabled for both frontend and backend"

# Ensure dependencies are up to date
echo "📦 Checking dependencies..."
pnpm install

# Run database migrations for development
echo "🛠 Running database migrations (dev)..."
(
    set -e
    cd apps/backend
    mkdir -p /data data
    if pnpm exec drizzle-kit migrate; then
        echo "✅ Migrations applied successfully"
    else
        echo "❌ Migration failed. See logs above."
        exit 1
    fi
)

# Start the development servers with proper signal handling
echo "🚀 Starting pnpm dev with turborepo..."
echo "💡 This will start both frontend and backend in development mode"
pnpm dev &
PNPM_PID=$!
echo "🚀 pnpm dev started with PID: $PNPM_PID"

# Wait for the pnpm dev process, but don't block cleanup
wait "$PNPM_PID" || true
