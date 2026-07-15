#!/data/data/com.termux/files/usr/bin/bash
#
# refresh.sh — Stop any running instance, pull the latest code, sync
# dependencies, and relaunch the service. Safe to run any time you want to
# make sure you're on the latest code (no stale background process).
#
# Usage (from inside the project folder):
#   bash refresh.sh

set -e

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "==============================================="
echo "  Refreshing Minecraft Bot Manager"
echo "==============================================="
echo ""

echo "[1/4] Stopping any running instance..."
pkill -f "node server.js" 2>/dev/null && echo "  Stopped a running process." || echo "  Nothing was running."

echo ""
echo "[2/4] Pulling latest code (branch: $BRANCH)..."
git pull origin "$BRANCH"

echo ""
echo "[3/4] Syncing dependencies..."
npm install

echo ""
echo "[4/4] Launching..."
echo ""
node server.js
