"""Public perps DB implementation surface.

This module is a stable OSS-facing shim over the broader shared SQLite layer.
It intentionally exports only the perps-relevant functions used by the public
repo so future internal refactors can happen behind this boundary.
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
