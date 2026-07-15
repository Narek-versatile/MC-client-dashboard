#!/data/data/com.termux/files/usr/bin/bash
#
# setup.sh — One-shot environment bootstrap for the Termux Minecraft Bot Manager.
#
# Usage (from inside Termux, in the cloned project folder):
#   bash setup.sh
#
# This script prepares a clean Termux installation so that the dashboard can be
# launched immediately afterwards with `node server.js`.

set -e

echo "==============================================="
echo "  Termux Minecraft Bot Manager — Setup"
echo "==============================================="
echo ""

# ----------------------------------------------------------------------------
# 1. Update & upgrade Termux packages
# ----------------------------------------------------------------------------
echo "[1/5] Updating Termux packages (this can take a minute)..."
pkg update -y && pkg upgrade -y

# ----------------------------------------------------------------------------
# 2. Install Node.js
# ----------------------------------------------------------------------------
echo ""
echo "[2/5] Installing Node.js..."
pkg install nodejs -y

# ----------------------------------------------------------------------------
# 3. Initialize the Node.js project (only if no package.json yet)
# ----------------------------------------------------------------------------
echo ""
echo "[3/5] Initializing the Node.js project..."
if [ ! -f package.json ]; then
  npm init -y
else
  echo "package.json already exists — skipping npm init."
fi

# ----------------------------------------------------------------------------
# 4. Install the required npm packages
#    - mineflayer 4.37.1 : the Minecraft bot engine (latest stable; there is
#                           no 26.1.2 release on npm)
#    - ws                : the WebSocket channel for the web dashboard
# ----------------------------------------------------------------------------
echo ""
echo "[4/5] Installing npm dependencies (mineflayer@4.37.1, ws)..."
npm install mineflayer@4.37.1 ws

# ----------------------------------------------------------------------------
# 5. Done
# ----------------------------------------------------------------------------
echo ""
echo "[5/5] Setup complete!"
echo ""
echo "==============================================="
echo "  All set. Launch the headless service with:"
echo ""
echo "      node server.js"
echo ""
echo "  Then open the dashboard in your phone browser:"
echo ""
echo "      http://localhost:3000"
echo ""
echo "==============================================="
