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

Shared underlying SQLite implementation:
- `trading_system/trading_db.py`

Public perps-facing module surface:
- `trading_system/perps_core.py`

Public perps-facing entrypoints:
- `trading_system/perps_db_cli.py`
- `trading_system/perps_sync_db.py`
- `trading_system/daily_analytics_report.py`

Shared internal bridge still present in repo:
- `trading_system/trading_db_cli.py`
- `trading_system/sync_trading_db.py`

## Messaging / approvals

`trading_system/perps_telegram_notifier.py` and `trading_system/perps_live_approval_bridge.py` handle operator-facing notifications and approval state.

## Adapter scaffold

`trading_system/perps_live_execution_adapter.mjs` and related fixtures/docs define the future real-order handoff boundary.
