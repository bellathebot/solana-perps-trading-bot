import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
export const REPO_ROOT = path.dirname(__filename);
const CONFIG_FILE = process.env.PERPS_BOT_CONFIG_FILE || path.join(REPO_ROOT, 'config', 'local.json');

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

const CONFIG = readConfig();
const cfg = (key, fallback) => process.env[key] || CONFIG[key] || fallback;

export const BOT_HOME = cfg('HERMES_PERPS_BOT_HOME', process.env.HOME || REPO_ROOT);
export const DATA_DIR = cfg('PERPS_AUTO_TRADE_DATA_DIR', path.join(BOT_HOME, '.trading-data'));
export const DB_PATH = cfg('PERPS_AUTO_TRADE_DB_PATH', path.join(DATA_DIR, 'trading.db'));
export const DB_CLI = cfg('PERPS_AUTO_TRADE_DB_CLI', path.join(REPO_ROOT, 'trading_system', 'perps_db_cli.py'));
export const JUP_BIN = cfg('JUP_BIN', 'jup');
export const HELIUS_BIN = cfg('HELIUS_BIN', 'helius');
export const TELEGRAM_TOKEN_FILE = cfg('TELEGRAM_TOKEN_FILE', path.join(REPO_ROOT, 'telegram.txt'));
export const TELEGRAM_TRADE_CHAT_ID = cfg('TELEGRAM_TRADE_CHAT_ID', '123456789');
export const DEFAULT_WALLET_ADDRESS = cfg('PERPS_WALLET_ADDRESS', 'REPLACE_ME_WALLET_ADDRESS');
export const PERPS_RUNTIME_ENV_FILE = cfg('PERPS_RUNTIME_ENV_FILE', path.join(DATA_DIR, 'perps-runtime.env'));
export const TRADING_PLAYBOOK_PATH = cfg('PERPS_TRADING_PLAYBOOK_PATH', path.join(REPO_ROOT, 'docs', 'research', 'playbook-snapshot.md'));

const inferredBinDirs = [
  process.env.JUP_BIN_DIR || CONFIG.JUP_BIN_DIR,
  process.env.HELIUS_BIN_DIR || CONFIG.HELIUS_BIN_DIR,
  process.env.HOME ? path.join(process.env.HOME, '.hermes', 'node', 'bin') : '',
  process.env.HOME ? path.join(process.env.HOME, '.cargo', 'bin') : '',
].filter(Boolean);

export const PATH_ENV = inferredBinDirs.length ? `${inferredBinDirs.join(':')}:${process.env.PATH || ''}` : (process.env.PATH || '');
export const PERPS_BOT_CONFIG_FILE = CONFIG_FILE;
