#!/usr/bin/env python3
import argparse
import json
import os
import re
from pathlib import Path

from trading_system.runtime_config import REPO_ROOT as ROOT, DATA_DIR, PERPS_RUNTIME_ENV_FILE as ENV_FILE
SERVICE_FILE = ROOT / '.config/systemd/user/perps-runtime-cycle.service'
TIMER_FILE = ROOT / '.config/systemd/user/perps-runtime-cycle.timer'
RUN_SCRIPT = ROOT / 'trading_system/run_perps_cycle.sh'
PERPS_EXECUTOR = ROOT / 'perps-auto-trade.mjs'
PERPS_MONITOR = ROOT / 'perps-monitor.mjs'
APPROVAL_BRIDGE = ROOT / 'trading_system/perps_live_approval_bridge.py'
NOTIFIER = ROOT / 'trading_system/perps_telegram_notifier.py'
ADAPTER_FILE = ROOT / 'trading_system/perps_live_execution_adapter.mjs'
ADAPTER_CONTRACT = ROOT / 'trading_system/perps_live_execution_adapter_contract.md'
ADAPTER_HARNESS = ROOT / 'trading_system/perps_live_execution_adapter_harness.mjs'
ADAPTER_REQUEST_FIXTURE = ROOT / 'trading_system/perps_live_execution_adapter_request_fixture.json'
ADAPTER_RESPONSE_FIXTURE = ROOT / 'trading_system/perps_live_execution_adapter_expected_response_fixture.json'
HANDOFF_CHECKLIST = ROOT / 'trading_system/perps_jupiter_live_handoff_checklist.md'
APPROVAL_FILE = DATA_DIR / 'telegram-bridge/perps_live_approval.json'
COMMAND_FILE = DATA_DIR / 'telegram-bridge/perps_live_commands.json'


def parse_env_file(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
    return env


def read_text(path: Path) -> str:
    return path.read_text() if path.exists() else ''


def check_file(path: Path) -> dict:
    return {'path': str(path), 'exists': path.exists()}


def build_summary() -> dict:
    env = parse_env_file(ENV_FILE)
    executor_text = read_text(PERPS_EXECUTOR)
    run_script = read_text(RUN_SCRIPT)

    hardcoded_paper = "const MODE = 'paper';" in executor_text
    live_stub_path = 'buildLiveStubPlan' in executor_text and 'openPaperShort(livePlan' in executor_text
    live_stub_event = 'perp_live_stub_entry_submitted' in executor_text

    live_requested = env.get('PERPS_AUTO_TRADE_MODE') == 'live'
    live_allowed = env.get('PERPS_AUTO_TRADE_ALLOW_LIVE') == '1'
    runtime_calls_executor = 'perps-auto-trade.mjs' in run_script
    runtime_calls_notifier = 'perps_telegram_notifier.py' in run_script
    runtime_calls_bridge = 'perps_live_approval_bridge.py' in run_script

    checks = {
        'env_file': check_file(ENV_FILE),
        'service_file': check_file(SERVICE_FILE),
        'timer_file': check_file(TIMER_FILE),
        'run_script': check_file(RUN_SCRIPT),
        'perps_executor': check_file(PERPS_EXECUTOR),
        'perps_monitor': check_file(PERPS_MONITOR),
        'approval_bridge': check_file(APPROVAL_BRIDGE),
        'telegram_notifier': check_file(NOTIFIER),
        'adapter_file': check_file(ADAPTER_FILE),
        'adapter_contract': check_file(ADAPTER_CONTRACT),
        'adapter_harness': check_file(ADAPTER_HARNESS),
        'adapter_request_fixture': check_file(ADAPTER_REQUEST_FIXTURE),
        'adapter_response_fixture': check_file(ADAPTER_RESPONSE_FIXTURE),
        'handoff_checklist': check_file(HANDOFF_CHECKLIST),
        'approval_file_present': APPROVAL_FILE.exists(),
        'command_file_present': COMMAND_FILE.exists(),
    }

    blockers = []
    ready_items = []

    if live_requested and live_allowed:
        ready_items.append('perps runtime env requests live mode and allows live path')
    else:
        blockers.append('perps runtime env is not armed for supervised live mode')

    if runtime_calls_executor and runtime_calls_notifier and runtime_calls_bridge:
        ready_items.append('runtime cycle includes executor, notifier, and approval bridge')
    else:
        blockers.append('runtime cycle is missing executor/notifier/approval bridge steps')

    if hardcoded_paper:
        blockers.append('perps executor still hardcodes MODE=paper')
    else:
        ready_items.append('perps executor does not hardcode paper mode')

    if checks['adapter_file']['exists'] and checks['adapter_contract']['exists']:
        ready_items.append('non-executing real-order adapter scaffold and contract are present')
    else:
        blockers.append('perps real-order adapter scaffold/contract missing')

    if checks['adapter_harness']['exists'] and checks['adapter_request_fixture']['exists'] and checks['adapter_response_fixture']['exists'] and checks['handoff_checklist']['exists']:
        ready_items.append('adapter harness, fixtures, and human handoff checklist are present')
    else:
        blockers.append('adapter harness/fixtures/handoff checklist missing')

    if live_stub_path and live_stub_event:
        blockers.append('perps live path is still live-stub only via buildLiveStubPlan -> openPaperShort')
    else:
        ready_items.append('perps live path is not obviously stub-only')

    status = 'supervised_live_stub_ready' if live_requested and live_allowed and runtime_calls_executor and runtime_calls_notifier and runtime_calls_bridge else 'not_ready'
    if hardcoded_paper or live_stub_path:
        status = 'supervised_live_stub_ready_but_not_true_live'

    return {
        'status': status,
        'checks': checks,
        'runtime_env': {
            'PERPS_AUTO_TRADE_MODE': env.get('PERPS_AUTO_TRADE_MODE'),
            'PERPS_AUTO_TRADE_ALLOW_LIVE': env.get('PERPS_AUTO_TRADE_ALLOW_LIVE'),
            'PERPS_AUTO_TRADE_LIVE_STUB_NOTIONAL_USD': env.get('PERPS_AUTO_TRADE_LIVE_STUB_NOTIONAL_USD'),
            'PERPS_MONITOR_PILOT_ASSETS': env.get('PERPS_MONITOR_PILOT_ASSETS'),
        },
        'ready_items': ready_items,
        'blockers': blockers,
        'true_live_blocker': 'real perps order placement is not wired; executor still uses live stub path' if (hardcoded_paper or live_stub_path) else None,
    }


def render_text(summary: dict) -> str:
    lines = [f"Perps readiness preflight: {summary['status']}"]
    for item in summary.get('ready_items') or []:
        lines.append(f"- ready: {item}")
    for item in summary.get('blockers') or []:
        lines.append(f"- blocker: {item}")
    env = summary.get('runtime_env') or {}
    lines.append(f"- env: mode={env.get('PERPS_AUTO_TRADE_MODE')} allow_live={env.get('PERPS_AUTO_TRADE_ALLOW_LIVE')} live_stub_notional={env.get('PERPS_AUTO_TRADE_LIVE_STUB_NOTIONAL_USD')} pilot_assets={env.get('PERPS_MONITOR_PILOT_ASSETS')}")
    if summary.get('true_live_blocker'):
        lines.append(f"- true_live_blocker: {summary['true_live_blocker']}")
    return '\n'.join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description='Perps readiness preflight summary')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    summary = build_summary()
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(render_text(summary))


if __name__ == '__main__':
    main()
