# Solana Perps Trading Bot

[![validate](https://github.com/bellathebot/solana-perps-trading-bot/actions/workflows/validate.yml/badge.svg)](https://github.com/bellathebot/solana-perps-trading-bot/actions/workflows/validate.yml)

A paper-first, supervised-live Solana perpetuals trading stack built around Jupiter perps monitoring, SQLite-backed analytics, and Telegram approval workflows.

This repository packages the current perps-trading work into a standalone project without local runtime secrets, wallet keys, Telegram tokens, SQLite contents, or machine-specific service state. The public export intentionally excludes spot-only operator tooling that is not required for the perps workflow.

## Project status

| Area | Status | Notes |
|---|---|---|
| Perps market monitoring | ready | `perps-monitor.mjs` records perps market/account state into SQLite |
| Paper perps execution | ready | `perps-auto-trade.mjs` is the main paper-first executor |
| Risk/event persistence | ready | SQLite captures perps candidates, orders, fills, positions, system events, and risk events |
| Telegram perps notifications | ready | perps notifier + approval bridge included |
| True live perps order placement | scaffold only | adapter contract/harness exist, but real order submission is intentionally unimplemented |
| Public OSS portability | partial | main entrypoints are portable; some shared internals still reflect the broader source runtime |

## Stability guide

- Stable enough to run locally:
  - `perps-monitor.mjs`
  - `perps-auto-trade.mjs`
  - `trading_system/perps_core.py`
  - `trading_system/perps_db_cli.py`
  - `trading_system/perps_sync_db.py`
  - `trading_system/perps_telegram_notifier.py`
  - `trading_system/perps_live_approval_bridge.py`
  - `trading_system/daily_analytics_report.py`
- Intentionally scaffolded:
  - `trading_system/perps_live_execution_adapter.mjs`
  - true live order placement path
- Still shared/internal-leaning:
  - parts of `trading_system/trading_db.py`
  - compatibility stubs retained to keep the public export runnable

## OSS roadmap

Short-term:
- keep public perps workflow stable and reproducible
- maintain syntax/fixture validation in GitHub Actions
- continue shrinking mixed legacy/shared runtime surfaces

Mid-term:
- split truly perps-only DB/service interfaces out of broader shared modules
- add perps-specific tests that do not depend on the larger internal runtime history
- improve configuration docs for non-source-machine setups

Later:
- wire a real live adapter behind the documented contract
- add stronger reconciliation/integration tests for supervised live flows
- publish cleaner schema docs for perps tables and event types

## Release snapshot

- Current export line: `v0.1.1`
- Public posture: paper-first, supervised-live-prep
- Pilot universe: `SOL`, `BTC`, `ETH`
- Live adapter state: scaffold only / fail-closed

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
- `trading_system/perps_db_impl.py` — public OSS-facing implementation shim over the broader shared SQLite layer
- `trading_system/perps_core.py` — smaller public perps-facing Python module surface over `perps_db_impl.py`
- `trading_system/perps_db_cli.py` — perps-only public CLI surface for SQLite reads/writes used by the perps stack
- `trading_system/perps_sync_db.py` — perps-facing sync wrapper for file/log ingestion into SQLite
- `trading_system/perps_telegram_notifier.py` — outbound Telegram notifications for executor and risk events
- `trading_system/perps_live_approval_bridge.py` — reads Telegram replies and updates perps approval/command bridge files
- `trading_system/perps_live_execution_adapter.mjs` — non-executing scaffold for future real Jupiter perps order wiring
- `trading_system/run_perps_cycle.sh` — repo-local orchestration script for the monitor/executor/notifier cycle
- `trading_system/daily_analytics_report.py` — perps-focused SQLite reporting summary

## Docs and references

- `docs/plans/2026-03-17-24-7-trading-roadmap.md`
- `docs/plans/2026-03-23-intraday-strategy-redesign.md`
- `docs/research/playbook-snapshot.md`
- `docs/reference/perps-schema.md`
- `examples/commands.md`
- `trading_system/perps_live_execution_adapter_contract.md`
- `trading_system/perps_jupiter_live_handoff_checklist.md`
- `CHANGELOG.md`
- `RELEASE_NOTES_v0.1.0.md`
- `RELEASE_NOTES_v0.1.1.md`

## Quick start

```bash
npm install
cp config/perps-bot.example.json config/local.json
PYTHONPATH=. python trading_system/perps_sync_db.py --db ~/.trading-data/trading.db --data-dir ~/.trading-data
node perps-monitor.mjs
node perps-auto-trade.mjs
```

## Validation

```bash
python -m py_compile trading_system/perps_db_impl.py trading_system/perps_core.py trading_system/perps_db_cli.py trading_system/perps_sync_db.py trading_system/perps_telegram_notifier.py trading_system/perps_live_approval_bridge.py trading_system/daily_analytics_report.py
node --check perps-monitor.mjs
node --check perps-auto-trade.mjs
node trading_system/perps_live_execution_adapter_harness.mjs
```
