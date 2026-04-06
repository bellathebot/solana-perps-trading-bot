#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${JUP_BIN_DIR:-$HOME/.hermes/node/bin}:${HELIUS_BIN_DIR:-$HOME/.hermes/node/bin}:$HOME/.cargo/bin:${PATH}"
export PYTHONPATH="$ROOT"

DATA_DIR="${PERPS_AUTO_TRADE_DATA_DIR:-$HOME/.trading-data}"
LOCK_FILE="${DATA_DIR}/perps_runtime_cycle.lock"
mkdir -p "${DATA_DIR}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "perps runtime cycle already active; skipping"
  exit 0
fi

echo "[$(date --iso-8601=seconds)] starting perps runtime cycle"
node "$ROOT/perps-monitor.mjs"
node "$ROOT/perps-auto-trade.mjs"
python "$ROOT/trading_system/perps_telegram_notifier.py"
python "$ROOT/trading_system/perps_live_approval_bridge.py"
python "$ROOT/trading_system/telegram_trade_reply_bridge.py"

echo "[$(date --iso-8601=seconds)] finished perps runtime cycle"
