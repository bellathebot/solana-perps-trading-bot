#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

from trading_system.runtime_config import DATA_DIR, PERPS_RUNTIME_ENV_FILE as ENV_FILE
REQUIRED_ENV_KEYS = [
    'PERPS_AUTO_TRADE_MODE',
    'PERPS_AUTO_TRADE_ALLOW_LIVE',
    'PERPS_AUTO_TRADE_DB_PATH',
    'PERPS_AUTO_TRADE_DATA_DIR',
]
FUTURE_HUMAN_ENV_KEYS = [
    'JUPITER_PERPS_LIVE_ADAPTER_IMPL',
    'JUPITER_PERPS_ACCOUNT_CONTEXT',
    'JUPITER_PERPS_ORDER_ROUTER',
    'JUPITER_PERPS_ORDER_STATUS_SOURCE',
    'JUPITER_PERPS_FILLS_SOURCE',
    'JUPITER_PERPS_POSITIONS_SOURCE',
]


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


def main() -> None:
    parser = argparse.ArgumentParser(description='Dry-run preflight for future human perps live adapter runtime inputs')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()

    file_env = parse_env_file(ENV_FILE)
    combined = {**file_env, **os.environ}

    required_present = {k: bool(combined.get(k)) for k in REQUIRED_ENV_KEYS}
    future_present = {k: bool(combined.get(k)) for k in FUTURE_HUMAN_ENV_KEYS}
    missing_required = [k for k, ok in required_present.items() if not ok]
    missing_future = [k for k, ok in future_present.items() if not ok]

    summary = {
        'status': 'dry_run_ready_for_human_wiring' if not missing_required else 'missing_required_runtime_inputs',
        'required_present': required_present,
        'future_human_inputs_present': future_present,
        'missing_required': missing_required,
        'missing_future_human_inputs': missing_future,
        'notes': [
            'Missing future human inputs are expected until a developer wires the real adapter.',
            'This preflight does not arm live execution; it only reports readiness of runtime inputs.',
        ],
    }

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"Perps adapter dry-run preflight: {summary['status']}")
        print('- required present: ' + ', '.join(f"{k}={'yes' if v else 'no'}" for k, v in required_present.items()))
        print('- future human inputs present: ' + ', '.join(f"{k}={'yes' if v else 'no'}" for k, v in future_present.items()))
        if missing_required:
            print('- missing_required: ' + ', '.join(missing_required))
        if missing_future:
            print('- missing_future_human_inputs: ' + ', '.join(missing_future))
        for note in summary['notes']:
            print(f"- note: {note}")


if __name__ == '__main__':
    main()
