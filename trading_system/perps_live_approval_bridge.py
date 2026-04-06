#!/usr/bin/env python3
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from trading_system.runtime_config import (
    BRIDGE_DIR,
    REPO_ROOT as ROOT,
    SESSIONS_DIR,
    SESSIONS_INDEX,
    TELEGRAM_TOKEN_FILE as TOKEN_FILE,
    TELEGRAM_TRADE_CHAT_ID as CHAT_ID,
)

APPROVAL_FILE = BRIDGE_DIR / 'perps_live_approval.json'
COMMAND_FILE = BRIDGE_DIR / 'perps_live_commands.json'
STATE_FILE = BRIDGE_DIR / 'perps_live_reply_bridge_state.json'
SESSION_KEY = f'agent:main:telegram:dm:{CHAT_ID}'


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def shorten(text: str, limit: int = 3000) -> str:
    text = (text or '').strip()
    return text if len(text) <= limit else text[:limit] + ' ...[truncated]'


def telegram_send(message: str):
    token = TOKEN_FILE.read_text().strip()
    data = urllib.parse.urlencode({'chat_id': CHAT_ID, 'text': shorten(message)}).encode()
    req = urllib.request.urlopen(f'https://api.telegram.org/bot{token}/sendMessage', data=data, timeout=20)
    return json.loads(req.read().decode())


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


def current_session_file():
    idx = load_json(SESSIONS_INDEX, {})
    meta = idx.get(SESSION_KEY)
    if not meta:
        return None
    session_id = meta.get('session_id')
    if not session_id:
        return None
    path = SESSIONS_DIR / f'session_{session_id}.json'
    return path if path.exists() else None


def extract_new_user_messages():
    state = load_json(STATE_FILE, {'last_session_path': None, 'last_user_count': 0, 'last_processed_command': None})
    session_path = current_session_file()
    if not session_path:
        return [], state
    session = load_json(session_path, {})
    user_messages = [m.get('content', '').strip() for m in session.get('messages', []) if m.get('role') == 'user']
    last_count = state['last_user_count'] if state.get('last_session_path') == str(session_path) else 0
    new_messages = user_messages[last_count:]
    state['last_session_path'] = str(session_path)
    state['last_user_count'] = len(user_messages)
    save_json(STATE_FILE, state)
    return new_messages, state


def parse_command(text: str):
    text = (text or '').strip()
    if not text:
        return None
    m = re.fullmatch(r'(?i)APPROVE_PERP\s+([A-Za-z0-9_:\-]+)', text)
    if m:
        return {'action': 'approve_perp', 'approval_id': m.group(1)}
    m = re.fullmatch(r'(?i)REJECT_PERP\s+([A-Za-z0-9_:\-]+)', text)
    if m:
        return {'action': 'reject_perp', 'approval_id': m.group(1)}
    m = re.fullmatch(r'(?i)FLATTEN_PERP\s+ALL', text)
    if m:
        return {'action': 'flatten_all'}
    m = re.fullmatch(r'(?i)CLOSE_PERP\s+([A-Za-z0-9_:\-]+)', text)
    if m:
        return {'action': 'close_position', 'target_ref': m.group(1)}
    m = re.fullmatch(r'(?i)REDUCE_PERP\s+([A-Za-z0-9_:\-]+)\s+(HALF|25|50|75)', text)
    if m:
        token = m.group(2).upper()
        fraction = {'HALF': 0.5, '25': 0.25, '50': 0.5, '75': 0.75}[token]
        return {'action': 'reduce_position', 'target_ref': m.group(1), 'reduction_fraction': fraction}
    return None


def load_approval():
    return load_json(APPROVAL_FILE, {'version': 1, 'status': 'idle'})


def save_approval(data):
    save_json(APPROVAL_FILE, data)


def load_command_state():
    return load_json(COMMAND_FILE, {'version': 1, 'command': None})


def save_command_state(data):
    save_json(COMMAND_FILE, data)


def approval_is_pending(approval):
    if not approval:
        return False
    if approval.get('status') != 'pending':
        return False
    expires = approval.get('expires_at')
    if not expires:
        return True
    try:
        return datetime.fromisoformat(expires) > datetime.now(timezone.utc)
    except Exception:
        return True


def handle(parsed):
    if parsed['action'] in {'approve_perp', 'reject_perp'}:
        approval = load_approval()
        if not approval_is_pending(approval):
            telegram_send('No pending perp approval request right now.')
            return
        if parsed['approval_id'] != approval.get('approval_id'):
            telegram_send(f"Approval ID mismatch. Current pending approval is {approval.get('approval_id')}")
            return
        approval['status'] = 'approved' if parsed['action'] == 'approve_perp' else 'rejected'
        approval['resolved_at'] = now_iso()
        approval['approved_at' if approval['status'] == 'approved' else 'rejected_at'] = now_iso()
        save_approval(approval)
        telegram_send(
            f"Perp approval {approval['approval_id']} {approval['status']}.\n"
            f"{approval.get('symbol')} {approval.get('signal_type')} size=${approval.get('size_usd')}"
        )
        return

    command_state = load_command_state()
    command_state['command'] = {
        'status': 'pending',
        'requested_at': now_iso(),
        'command_type': parsed['action'],
        'target_ref': parsed.get('target_ref'),
        'reduction_fraction': parsed.get('reduction_fraction'),
        'source': 'telegram',
    }
    save_command_state(command_state)
    if parsed['action'] == 'flatten_all':
        telegram_send('Submitted FLATTEN_PERP ALL command to the perp executor.')
    elif parsed['action'] == 'close_position':
        telegram_send(f"Submitted CLOSE_PERP {parsed['target_ref']} command to the perp executor.")
    else:
        telegram_send(f"Submitted REDUCE_PERP {parsed['target_ref']} {parsed['reduction_fraction']:.2f} command to the perp executor.")


def main():
    messages, state = extract_new_user_messages()
    acted = False
    for text in messages:
        parsed = parse_command(text)
        if parsed:
            state['last_processed_command'] = text
            save_json(STATE_FILE, state)
            handle(parsed)
            acted = True
    if not acted:
        print('NO_COMMAND')
    else:
        print('COMMAND_PROCESSED')


if __name__ == '__main__':
    main()
