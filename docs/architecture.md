# Architecture

## Overview

The exported perps stack has four main layers:

1. Perps market monitoring
2. Paper-first execution and risk gating
3. SQLite analytics / policy generation
4. Operator messaging and approval bridges

## Monitoring

`perps-monitor.mjs` observes market/account state, records snapshots, and emits perps candidates.

## Execution

`perps-auto-trade.mjs` runs paper-first, enforces guardrails, journals state, and can emit supervised-live approval intents.

## Analytics

`trading_system/trading_db.py`, `trading_system/trading_db_cli.py`, and `trading_system/sync_trading_db.py` store and retrieve runtime state.

## Messaging / approvals

`trading_system/perps_telegram_notifier.py`, `trading_system/perps_live_approval_bridge.py`, and `trading_system/telegram_trade_reply_bridge.py` handle operator-facing notifications and commands.

## Adapter scaffold

`trading_system/perps_live_execution_adapter.mjs` and related fixtures/docs define the future real-order handoff boundary.
