# Perps Schema Reference

This document describes the main perps-facing SQLite tables and event streams exposed by the public repo.

## Core tables

### `perp_market_snapshots`
Captured by: `perps-monitor.mjs`

Typical fields:
- `ts`
- `asset`
- `price_usd`
- `change_pct_24h`
- `volume_usd_24h`
- `open_interest_usd`
- `funding_rate`
- `raw_json`

Purpose:
- historical market context for candidate generation and reporting

### `perp_account_snapshots`
Captured by: `perps-monitor.mjs`

Typical fields:
- `ts`
- `wallet_address`
- `open_position_count`
- `open_notional_usd`
- `unrealized_pnl_usd`
- `realized_pnl_usd`
- `margin_used_usd`
- `equity_estimate_usd`
- `raw_json`

Purpose:
- account-level state over time

### `perp_positions`
Written by:
- `perps-monitor.mjs`
- `perps-auto-trade.mjs`

Typical fields:
- `position_key`
- `asset`
- `side`
- `status`
- `entry_price_usd`
- `mark_price_usd`
- `liq_price_usd`
- `notional_usd`
- `margin_used_usd`
- `leverage`
- `unrealized_pnl_usd`
- `realized_pnl_usd`
- `strategy_tag`
- `mode`
- `raw_json`

Purpose:
- open/closed perps position state and lifecycle tracking

### `perp_orders`
Written by:
- `perps-monitor.mjs`
- `perps-auto-trade.mjs`

Typical fields:
- `order_key`
- `position_key`
- `asset`
- `side`
- `order_type`
- `status`
- `size_usd`
- `limit_price`
- `trigger_price`
- `slippage_bps`
- `strategy_tag`
- `mode`
- `raw_json`

Purpose:
- order lifecycle and execution intent tracking

### `perp_fills`
Written by:
- `perps-monitor.mjs`
- `perps-auto-trade.mjs`

Typical fields:
- `ts`
- `position_key`
- `order_key`
- `asset`
- `side`
- `action`
- `price_usd`
- `size_usd`
- `fees_usd`
- `funding_usd`
- `realized_pnl_usd`
- `strategy_tag`
- `mode`
- `raw_json`

Purpose:
- realized execution/fill history

### `perp_signal_candidates`
Written by:
- `perps-monitor.mjs`
- `perps-auto-trade.mjs`

Typical fields:
- `ts`
- `decision_id`
- `signal_type`
- `symbol` / `asset`
- `entry_score`
- `edge_pct`
- `status`
- `reason`
- `product_type`
- `metadata_json`

Purpose:
- shadow-book and candidate-lane analytics

## Event streams

### `system_events`
Public perps event families commonly used:
- `perp_executor_decision`
- `perp_executor_recovery`
- `perp_live_policy_denied`
- `perp_live_mode_stubbed`
- `perp_live_approval_requested`
- `perp_live_stub_entry_submitted`
- `perp_flatten_all_completed`
- `perp_manual_position_command_executed`

Purpose:
- operator-facing execution/system lifecycle reporting

### `risk_events`
Public perps risk event families commonly used:
- `perp_entry_risk_guard_block`
- `perp_execution_response_drift`
- `perp_submit_timeout_ambiguous`
- `perp_orphan_position_recovered`
- `perp_daily_loss_cap_hit`
- `perp_executor_disabled`
- `perp_executor_error`
- `perp_multiple_open_positions_detected`
- `perp_entry_stale_quote_rejected`
- `perp_partial_fill_cancelled_remainder`

Purpose:
- risk/audit trail for guardrails and degraded execution conditions

## Public CLI surface

Use:
- `trading_system/perps_db_cli.py`
- `trading_system/perps_sync_db.py`

Example:

```bash
PYTHONPATH=. python trading_system/perps_db_cli.py perp-summary --db ~/.trading-data/trading.db
PYTHONPATH=. python trading_system/perps_db_cli.py perp-executor-state --db ~/.trading-data/trading.db --minutes 240
```

## Notes

- The public repo now routes its main runtime path through `trading_system/perps_db_impl.py`.
- Historical planning docs may still mention older mixed file names, but the active public runtime path is perps-native.
