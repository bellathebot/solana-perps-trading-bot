# Setup

Main entrypoints no longer require `/home/brimigs/...` hard-coded paths.

Important runtime variables:

- `HERMES_PERPS_BOT_HOME`
- `PERPS_AUTO_TRADE_DATA_DIR`
- `PERPS_AUTO_TRADE_DB_PATH`
- `PERPS_WALLET_ADDRESS`
- `JUP_BIN`
- `HELIUS_BIN`
- `TELEGRAM_TOKEN_FILE`
- `TELEGRAM_TRADE_CHAT_ID`

Quick start:

```bash
./scripts/bootstrap.sh
cp config/perps-bot.example.json config/local.json
```

Then initialize/sync the DB:

```bash
PYTHONPATH=. python trading_system/perps_sync_db.py --db ~/.trading-data/trading.db --data-dir ~/.trading-data
```

Public-facing perps CLI path:

```bash
PYTHONPATH=. python trading_system/perps_db_cli.py perp-summary --db ~/.trading-data/trading.db
```

Schema reference:

- `docs/reference/perps-schema.md`

The public export includes the perps notifier and perps approval bridge, but not the older spot-only Telegram review tooling.
