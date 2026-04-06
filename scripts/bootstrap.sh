#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${PERPS_AUTO_TRADE_DATA_DIR:-$HOME/.trading-data}"
DB_PATH="${PERPS_AUTO_TRADE_DB_PATH:-$DATA_DIR/trading.db}"

mkdir -p "$DATA_DIR/telegram-bridge"
npm install

echo "Repo root: $ROOT"
echo "Data dir:   $DATA_DIR"
echo "DB path:    $DB_PATH"
echo "Next: PYTHONPATH="$ROOT" python "$ROOT/trading_system/sync_trading_db.py" --db "$DB_PATH" --data-dir "$DATA_DIR""
