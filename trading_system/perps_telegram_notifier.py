#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import urllib.parse
import urllib.request
from pathlib import Path

from trading_system.runtime_config import (
    BRIDGE_DIR,
    DATA_DIR,
    DB_PATH as DEFAULT_DB,
    TELEGRAM_TOKEN_FILE as TOKEN_FILE,
    TELEGRAM_TRADE_CHAT_ID as CHAT_ID,
)

STATE_FILE = BRIDGE_DIR / 'perps_executor_alert_state.json'

SYSTEM_EVENT_TYPES = {
    'perp_executor_decision',
    'perp_executor_recovery',
    'perp_live_policy_denied',
    'perp_live_mode_stubbed',
    'perp_live_approval_requested',
    'perp_live_stub_entry_submitted',
    'perp_flatten_all_completed',
    'perp_manual_position_command_executed',
}
RISK_EVENT_TYPES = {
    'perp_entry_risk_guard_block',
    'perp_execution_response_drift',
    'perp_submit_timeout_ambiguous',
    'perp_orphan_position_recovered',
    'perp_daily_loss_cap_hit',
    'perp_executor_disabled',
    'perp_executor_error',
    'perp_multiple_open_positions_detected',
    'perp_entry_stale_quote_rejected',
    'perp_partial_fill_cancelled_remainder',
    'perp_live_policy_denied',
    'perp_live_mode_stubbed',
    'perp_flatten_all_completed',
}


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def telegram_send(message: str):
    token = TOKEN_FILE.read_text().strip()
    data = urllib.parse.urlencode({'chat_id': CHAT_ID, 'text': message}).encode()
    req = urllib.request.urlopen(f'https://api.telegram.org/bot{token}/sendMessage', data=data, timeout=20)
    return json.loads(req.read().decode())




def shorten(value, limit=500):
    text = '' if value is None else str(value)
    return text if len(text) <= limit else text[:limit] + ' ...[truncated]'

def parse_json(text: str | None):
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def load_state():
    return load_json(STATE_FILE, {'last_system_event_id': 0, 'last_risk_event_id': 0})


def fetch_pending_events(db_path: Path, state: dict):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        system_rows = conn.execute(
            '''
            SELECT id, ts, event_type, severity, message, metadata_json
            FROM system_events
            WHERE id > ?
              AND event_type IN ({})
              AND COALESCE(source, '') = 'perps-auto-trade.mjs'
            ORDER BY id ASC
            '''.format(','.join('?' for _ in SYSTEM_EVENT_TYPES)),
            [state.get('last_system_event_id', 0), *sorted(SYSTEM_EVENT_TYPES)],
        ).fetchall()
        risk_rows = conn.execute(
            '''
            SELECT id, ts, event_type, severity, message, metadata_json
            FROM risk_events
            WHERE id > ?
              AND COALESCE(product_type, 'perps') = 'perps'
              AND event_type IN ({})
            ORDER BY id ASC
            '''.format(','.join('?' for _ in RISK_EVENT_TYPES)),
            [state.get('last_risk_event_id', 0), *sorted(RISK_EVENT_TYPES)],
        ).fetchall()
        max_system_id = conn.execute('SELECT COALESCE(MAX(id), 0) FROM system_events').fetchone()[0]
        max_risk_id = conn.execute('SELECT COALESCE(MAX(id), 0) FROM risk_events').fetchone()[0]
        return list(system_rows), list(risk_rows), max_system_id, max_risk_id
    finally:
        conn.close()


def should_alert_system(row: sqlite3.Row, metadata: dict) -> bool:
    event_type = row['event_type']
    if event_type in {'perp_executor_recovery', 'perp_live_policy_denied', 'perp_live_mode_stubbed', 'perp_live_approval_requested', 'perp_live_stub_entry_submitted', 'perp_flatten_all_completed', 'perp_manual_position_command_executed'}:
        return True
    if event_type != 'perp_executor_decision':
        return False
    message = (row['message'] or '').lower()
    if any(token in message for token in ['opened paper short', 'closed paper short', 'reduced paper short']):
        return True
    if metadata.get('fill_status') == 'partially_filled' or metadata.get('live_stub'):
        return True
    return False


def format_system_message(row: sqlite3.Row, metadata: dict) -> str:
    event_type = row['event_type']
    if event_type == 'perp_executor_recovery':
        return '\n'.join([
            'Perps executor recovery',
            f"time: {row['ts']}",
            f"message: {shorten(row['message'])}",
            f"symbol: {metadata.get('symbol') or metadata.get('summary', {}).get('symbol') or 'n/a'}",
            f"decision: {metadata.get('decision_id') or metadata.get('summary', {}).get('decision_id') or 'n/a'}",
        ])
    if event_type in {'perp_live_policy_denied', 'perp_live_mode_stubbed'}:
        return '\n'.join([
            f"Perps executor {event_type}",
            f"time: {row['ts']}",
            f"policy_status: {metadata.get('policy_status') or 'n/a'}",
            f"reason: {metadata.get('denial_reason') or metadata.get('candidate_strategy') or row['message']}",
            f"symbol: {metadata.get('candidate_symbol') or 'n/a'}",
        ])
    if event_type == 'perp_live_approval_requested':
        intent = metadata.get('approval_intent') or {}
        return '\n'.join([
            'Perp live approval required',
            f"time: {row['ts']}",
            f"symbol: {intent.get('symbol') or 'n/a'}",
            f"signal: {intent.get('signal_type') or 'n/a'}",
            f"decision: {intent.get('decision_id') or 'n/a'}",
            f"size_usd: {intent.get('size_usd') if intent.get('size_usd') is not None else 'n/a'}",
            f"entry: {intent.get('entry_price') if intent.get('entry_price') is not None else 'n/a'}",
            f"stop: {intent.get('stop_loss_price') if intent.get('stop_loss_price') is not None else 'n/a'}",
            f"target: {intent.get('take_profit_price') if intent.get('take_profit_price') is not None else 'n/a'}",
            '',
            f"Approve: {intent.get('commands', {}).get('approve', 'n/a')}",
            f"Reject: {intent.get('commands', {}).get('reject', 'n/a')}",
            f"Emergency: {intent.get('commands', {}).get('flatten_all', 'n/a')}",
        ])
    if event_type in {'perp_flatten_all_completed', 'perp_manual_position_command_executed'}:
        return '\n'.join([
            'Perp manual command executed',
            f"time: {row['ts']}",
            f"event: {event_type}",
            f"message: {shorten(row['message'])}",
            f"target: {metadata.get('target_position_key') or 'all'}",
            f"decision: {metadata.get('target_decision_id') or 'n/a'}",
            f"reduction_fraction: {metadata.get('reduction_fraction') if metadata.get('reduction_fraction') is not None else 'n/a'}",
        ])
    return '\n'.join([
        'Perps executor trade event',
        f"time: {row['ts']}",
        f"message: {shorten(row['message'])}",
        f"symbol: {metadata.get('symbol') or 'n/a'}",
        f"signal: {metadata.get('signal_type') or 'n/a'}",
        f"decision: {metadata.get('decision_id') or 'n/a'}",
        f"size_usd: {metadata.get('size_usd') if metadata.get('size_usd') is not None else 'n/a'}",
        f"entry_price: {metadata.get('entry_price') if metadata.get('entry_price') is not None else metadata.get('exit_price', 'n/a')}",
        f"pnl_usd: {metadata.get('realized_pnl_usd') if metadata.get('realized_pnl_usd') is not None else 'n/a'}",
        f"live_stub: {metadata.get('live_stub') if metadata.get('live_stub') is not None else 'n/a'}",
    ])


def format_risk_message(row: sqlite3.Row, metadata: dict) -> str:
    guard = metadata.get('guard_context') or {}
    exec_est = guard.get('execution_estimates') or {}
    parts = [
        f"Perps risk event: {row['event_type']}",
        f"time: {row['ts']}",
        f"severity: {row['severity']}",
        f"message: {shorten(row['message'])}",
        f"symbol: {metadata.get('symbol') or metadata.get('candidate_symbol') or 'n/a'}",
        f"decision: {metadata.get('decision_id') or 'n/a'}",
    ]
    if metadata.get('block_reason'):
        parts.append(f"block_reason: {metadata['block_reason']}")
    if guard.get('notional_to_equity_pct') is not None:
        parts.append(f"notional_to_equity_pct: {guard['notional_to_equity_pct']}")
    if guard.get('equity', {}).get('current_drawdown_pct') is not None:
        parts.append(f"drawdown_pct: {guard['equity']['current_drawdown_pct']}")
    if exec_est.get('spread_bps') is not None:
        parts.append(f"spread_bps: {exec_est['spread_bps']}")
    if exec_est.get('slippage_bps') is not None:
        parts.append(f"slippage_bps: {exec_est['slippage_bps']}")
    rendered = '\n'.join(parts)
    return shorten(rendered, 3000)


def build_messages(system_rows, risk_rows):
    messages = []
    for row in system_rows:
        metadata = parse_json(row['metadata_json'])
        if should_alert_system(row, metadata):
            messages.append(('system', row['id'], shorten(format_system_message(row, metadata), 3000)))
    for row in risk_rows:
        metadata = parse_json(row['metadata_json'])
        messages.append(('risk', row['id'], shorten(format_risk_message(row, metadata), 3000)))
    return messages


def prime_state(db_path: Path):
    conn = sqlite3.connect(db_path)
    try:
        max_system_id = conn.execute('SELECT COALESCE(MAX(id), 0) FROM system_events').fetchone()[0]
        max_risk_id = conn.execute('SELECT COALESCE(MAX(id), 0) FROM risk_events').fetchone()[0]
    finally:
        conn.close()
    state = {'last_system_event_id': max_system_id, 'last_risk_event_id': max_risk_id}
    save_json(STATE_FILE, state)
    return state


def main():
    parser = argparse.ArgumentParser(description='Send Telegram alerts for perp executor events')
    parser.add_argument('--db', default=str(DEFAULT_DB))
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--prime-only', action='store_true')
    args = parser.parse_args()

    db_path = Path(args.db)
    if args.prime_only or not STATE_FILE.exists():
        state = prime_state(db_path)
        if args.prime_only:
            print(json.dumps({'status': 'PRIMED', **state}))
            return

    state = load_state()
    system_rows, risk_rows, max_system_id, max_risk_id = fetch_pending_events(db_path, state)
    messages = build_messages(system_rows, risk_rows)

    sent = []
    for category, event_id, message in messages:
        if args.dry_run:
            sent.append({'category': category, 'event_id': event_id, 'message': message})
        else:
            telegram_send(message)
            sent.append({'category': category, 'event_id': event_id})

    state['last_system_event_id'] = max_system_id
    state['last_risk_event_id'] = max_risk_id
    save_json(STATE_FILE, state)
    print(json.dumps({'status': 'OK', 'sent': sent, **state}, indent=2))


if __name__ == '__main__':
    main()
