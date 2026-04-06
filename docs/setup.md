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
