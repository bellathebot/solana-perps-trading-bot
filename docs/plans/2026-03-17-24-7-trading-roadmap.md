# 24/7 Solana Active Trader Roadmap

> For Hermes: Use subagent-driven-development skill to execute future major phases task-by-task.

Goal: Evolve the current small automated Solana setup into a disciplined, always-on, data-driven active trading system, then progressively toward higher-frequency execution.

Architecture: Build in four layers: observability/data capture, paper-trading strategy evaluation, controlled live execution, and finally event-driven higher-frequency infrastructure. Keep Jupiter as the primary execution path for now, use strict capital preservation guardrails, and promote only strategies that survive paper and small-live validation.

Tech Stack: Jupiter CLI/API, Helius CLI/API, Node.js monitors/execution scripts, Python stdlib sqlite3 for analytics DB, cron initially, later event-driven services/websockets.

---

## Phase 0: Safety and Measurement Baseline

Success criteria:
- Every automated action is logged.
- Paper and live modes are clearly separated.
- Risk controls are explicit and documented.

Concrete deliverables:
- `auto-trade.mjs` defaults to paper mode.
- `monitor.mjs` matches the playbook alert rules.
- `.trading-data/trading.db` exists and can ingest logs.
- `trading.md` stays aligned with automation behavior.

## Phase 1: Observability + Data Warehouse

Purpose: understand what the system is doing before increasing speed or capital.

Need to build:
- SQLite database for snapshots, price points, alerts, trades, and whale observations
- import/sync scripts from existing JSON/log files
- retention policy and schema versioning
- daily summary queries for PnL, signals, and token behavior

Success criteria:
- historical snapshots are queryable by time and symbol
- alerts and paper/live trades are queryable
- one command can sync current logs into SQLite

## Phase 2: Strategy Research in Paper Mode

Purpose: learn which strategies have actual edge.

Candidate strategies:
- near-buy mean reversion on watchlist tokens
- whale-follow reaction strategy
- momentum continuation strategy
- route-dislocation / quote divergence detector

Need to build:
- strategy tagging in the database
- paper-trade ledger with entry/exit reasoning
- performance metrics: win rate, expectancy, drawdown, holding time, fill drift
- daily/weekly strategy report

Success criteria:
- at least 2 strategies produce analyzable paper results
- strategy stats can be compared over a 7-30 day window
- losing strategies can be paused automatically

## Phase 3: Controlled Live Automation

Purpose: graduate the best paper strategy into tiny live trading.

Need to build:
- live-vs-paper comparison reporting
- daily kill switch logic
- max loss / max drawdown enforcement
- per-token and per-strategy exposure caps
- health checks for Solana/Jupiter degradation

Success criteria:
- live trading only runs when risk checks pass
- automatic pause on failures or drawdown breach
- live fills are logged and reconciled against quotes

## Phase 4: Always-On Active Trader

Purpose: move beyond cron into a durable service.

Need to build:
- long-running process manager / watchdog
- structured logs
- restart-safe state recovery
- event queue for alerts, whale activity, and execution decisions
- dashboard or reporting layer over SQLite

Success criteria:
- bot runs 24/7 safely
- system survives restarts without duplicating orders
- latency, fill quality, and PnL are continuously measurable

## Phase 5: Higher-Frequency Upgrade Path

Purpose: approach true high-frequency behavior only after the system proves robust.

Need to build:
- websocket/event-driven price and wallet ingestion
- faster quote polling where justified
- route-quality and quote-decay tracking
- microstructure analytics: slippage drift, landing delay, failed tx analysis
- optional Jito / lower-latency execution research if allowed later

Success criteria:
- we can quantify whether speed improvements create real edge
- we know which markets/tokens are tradable at higher frequency
- system avoids fake HFT complexity without measured benefit

---

## Immediate Milestones (next 7 days)

1. Create SQLite DB + sync tool.
2. Backfill existing snapshots, alerts, and auto-trades.
3. Add whale-observation table and nightly import path.
4. Split paper and live performance reporting.
5. Create first daily analytics summary from SQLite.

## Immediate Milestones (next 30 days)

1. Run paper mode continuously.
2. Collect enough data to rank strategies.
3. Add kill switches and portfolio-level limits.
4. Start tiny live deployment only for validated setups.

## Hard prerequisites before “real HFT” claims

- larger capital base
- event-driven data ingestion
- measured quote-to-fill slippage data
- reliable always-on runtime
- explicit risk budget from the user
- proven strategy edge after fees/latency

## What not to do yet

- do not market-make blindly
- do not scale capital before measuring fill quality
- do not call cron-based polling “HFT”
- do not trade illiquid memecoins without execution analytics

## Files to build first

- Create: `trading_system/trading_db.py`
- Create: `trading_system/tests/test_trading_db.py`
- Create: `trading_system/sync_trading_db.py`
- Create: `docs/plans/2026-03-17-24-7-trading-roadmap.md`
- Database: `.trading-data/trading.db`

## Verification plan

- `python -m unittest trading_system/tests/test_trading_db.py`
- `python trading_system/sync_trading_db.py --db .trading-data/trading.db --data-dir .trading-data`
- query row counts from SQLite to verify snapshots, price points, alerts, and trades loaded
