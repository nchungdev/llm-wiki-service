#!/bin/bash

# Configuration
PORT=${PORT:-3030}
VENV_DIR="venv"

echo "🚀 Starting AI Librarian Service..."

# 1. Setup Environment
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv $VENV_DIR
fi

source $VENV_DIR/bin/activate
pip install -r requirements.txt --quiet

# 2. Process Management Utility
release_port() {
    echo "🧹 Checking port $PORT..."
    PIDS=$(lsof -ti :$PORT)
    if [ ! -z "$PIDS" ]; then
        echo "🔥 Releasing port $PORT (killing processes: $PIDS)..."
        kill -9 $PIDS 2>/dev/null || true
        sleep 1
    fi
}

# 3. Mode Selection
ROOT_DIR=$(pwd)

if [ "$1" == "--build-only" ]; then
    echo "🏗️  Building Admin UI Only..."
    cd "$ROOT_DIR/admin" && npm run build
    cd "$ROOT_DIR"
    echo "✅ Build complete. Static files updated."
    exit 0
fi

if [ "$1" == "--dev" ]; then
    release_port
    echo "🛠️ Starting in DEV mode with Auto-Reload..."
    VITE_PID=$(lsof -ti :5173)
    [ ! -z "$VITE_PID" ] && kill -9 $VITE_PID 2>/dev/null
    
    cd "$ROOT_DIR/admin" && npm run dev &
    cd "$ROOT_DIR"
    python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT --reload --reload-include "config.json"
else
    # Default: Always rebuild and start
    echo "🏗️  Building Admin UI..."
    cd "$ROOT_DIR/admin"
    if ! npm run build; then
        echo "❌ Build failed. Please check TypeScript errors above."
        exit 1
    fi
    cd "$ROOT_DIR"
    
    release_port
    echo "🌐 Server starting on http://localhost:$PORT"
    python3 main.py
fi
