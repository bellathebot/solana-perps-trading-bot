# Solana Perps Trading Bot

A paper-first, supervised-live Solana perpetuals trading stack built around Jupiter perps monitoring, SQLite-backed analytics, and Telegram approval workflows.

This repository packages the current perps-trading work into a standalone project without local runtime secrets, wallet keys, Telegram tokens, SQLite contents, or machine-specific service state. The public export intentionally excludes spot-only operator tooling that is not required for the perps workflow.

## What it does

- Monitors Jupiter perps markets for a small pilot asset basket
- Scores bearish continuation / failed-bounce short setups
- Runs paper-first perps execution with strict notional, cooldown, drawdown, and kill-switch guardrails
- Persists perps candidates, orders, fills, positions, system events, and risk events into SQLite
- Supports supervised-live approval intents over Telegram
- Includes a non-executing live adapter scaffold, fixtures, and handoff checklist for future real-order wiring

## Core components

- `perps-monitor.mjs` — polls Jupiter perps markets, positions, and history, then records market/account state and perps candidate rows
- `perps-auto-trade.mjs` — paper-first perps executor with explicit live gating and recovery journaling
- `trading_system/trading_db.py` — SQLite schema and analytics logic used by the perps stack
- `trading_system/trading_db_cli.py` — Python CLI bridge used by the Node entrypoints
- `trading_system/perps_telegram_notifier.py` — outbound Telegram notifications for executor and risk events
- `trading_system/perps_live_approval_bridge.py` — reads Telegram replies and updates perps approval/command bridge files
- `trading_system/perps_live_execution_adapter.mjs` — non-executing scaffold for future real Jupiter perps order wiring
- `trading_system/run_perps_cycle.sh` — repo-local orchestration script for the monitor/executor/notifier cycle
- `trading_system/daily_analytics_report.py` — perps-focused SQLite reporting summary

## Research and design docs included

- `docs/plans/2026-03-17-24-7-trading-roadmap.md`
- `docs/plans/2026-03-23-intraday-strategy-redesign.md`
- `docs/research/playbook-snapshot.md`
- `trading_system/perps_live_execution_adapter_contract.md`
- `trading_system/perps_jupiter_live_handoff_checklist.md`

## Quick start

```bash
npm install
cp config/perps-bot.example.json config/local.json
PYTHONPATH=. python trading_system/sync_trading_db.py --db ~/.trading-data/trading.db --data-dir ~/.trading-data
node perps-monitor.mjs
node perps-auto-trade.mjs
```
