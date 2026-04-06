from __future__ import annotations

import json
import os
from pathlib import Path

REPO_ROOT = Path(os.environ.get('PERPS_BOT_REPO_ROOT', Path(__file__).resolve().parents[1]))
CONFIG_FILE = Path(os.environ.get('PERPS_BOT_CONFIG_FILE', str(REPO_ROOT / 'config' / 'local.json')))

try:
    _raw = json.loads(CONFIG_FILE.read_text()) if CONFIG_FILE.exists() else {}
    CONFIG = _raw if isinstance(_raw, dict) else {}
except Exception:
    CONFIG = {}


def cfg(key: str, fallback: str) -> str:
    return os.environ.get(key) or CONFIG.get(key) or fallback

BOT_HOME = Path(cfg('HERMES_PERPS_BOT_HOME', os.environ.get('HOME', str(REPO_ROOT))))
DATA_DIR = Path(cfg('PERPS_AUTO_TRADE_DATA_DIR', str(BOT_HOME / '.trading-data')))
DB_PATH = Path(cfg('PERPS_AUTO_TRADE_DB_PATH', str(DATA_DIR / 'trading.db')))
BRIDGE_DIR = DATA_DIR / 'telegram-bridge'
TELEGRAM_TOKEN_FILE = Path(cfg('TELEGRAM_TOKEN_FILE', str(REPO_ROOT / 'telegram.txt')))
TELEGRAM_TRADE_CHAT_ID = cfg('TELEGRAM_TRADE_CHAT_ID', '123456789')
JUP_BIN = cfg('JUP_BIN', 'jup')
HELIUS_BIN = cfg('HELIUS_BIN', 'helius')
PERPS_MONITOR_PATH = Path(cfg('PERPS_MONITOR_PATH', str(REPO_ROOT / 'perps-monitor.mjs')))
PERPS_EXECUTOR_PATH = Path(cfg('PERPS_EXECUTOR_PATH', str(REPO_ROOT / 'perps-auto-trade.mjs')))
PERPS_RUNTIME_ENV_FILE = Path(cfg('PERPS_RUNTIME_ENV_FILE', str(DATA_DIR / 'perps-runtime.env')))
PERPS_WALLET_ADDRESS = cfg('PERPS_WALLET_ADDRESS', 'REPLACE_ME_WALLET_ADDRESS')
SESSIONS_INDEX = REPO_ROOT / '.hermes' / 'sessions' / 'sessions.json'
SESSIONS_DIR = REPO_ROOT / '.hermes' / 'sessions'


def build_path_env() -> str:
    extras = []
    home = os.environ.get('HOME')
    if os.environ.get('JUP_BIN_DIR') or CONFIG.get('JUP_BIN_DIR'):
        extras.append(os.environ.get('JUP_BIN_DIR') or CONFIG.get('JUP_BIN_DIR'))
    if os.environ.get('HELIUS_BIN_DIR') or CONFIG.get('HELIUS_BIN_DIR'):
        extras.append(os.environ.get('HELIUS_BIN_DIR') or CONFIG.get('HELIUS_BIN_DIR'))
    if home:
        extras.append(str(Path(home) / '.hermes' / 'node' / 'bin'))
        extras.append(str(Path(home) / '.cargo' / 'bin'))
    extras = [p for p in extras if p]
    return ':'.join(extras + [os.environ.get('PATH', '')]) if extras else os.environ.get('PATH', '')
