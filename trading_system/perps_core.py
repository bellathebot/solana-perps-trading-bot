"""Public perps-facing database surface for the OSS export.

This module intentionally re-exports only the perps-relevant subset of the
broader shared SQLite analytics layer used by the public perps workflow.
"""

from trading_system.trading_db import (
    get_perp_executor_state,
    get_perp_open_positions,
    get_perp_summary,
    get_recent_perp_market_history,
    get_strategy_execution_policy,
    record_auto_trade,
    record_perp_account_snapshot,
    record_perp_fill,
    record_perp_market_snapshot,
    record_perp_order,
    record_risk_event,
    record_signal_candidate,
    record_system_event,
    upsert_perp_position,
)

__all__ = [
    'get_perp_executor_state',
    'get_perp_open_positions',
    'get_perp_summary',
    'get_recent_perp_market_history',
    'get_strategy_execution_policy',
    'record_auto_trade',
    'record_perp_account_snapshot',
    'record_perp_fill',
    'record_perp_market_snapshot',
    'record_perp_order',
    'record_risk_event',
    'record_signal_candidate',
    'record_system_event',
    'upsert_perp_position',
]
