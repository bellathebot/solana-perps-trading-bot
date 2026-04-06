#!/usr/bin/env python3
import json
import subprocess
from trading_system.runtime_config import REPO_ROOT


def run(cmd):
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=180)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip() or f'command failed: {cmd}')
    return res.stdout.strip()


def main():
    preflight = run(f"python {REPO_ROOT / 'trading_system' / 'perps_readiness_preflight.py'}")
    dry_run = run(f"python {REPO_ROOT / 'trading_system' / 'perps_live_adapter_dry_run_preflight.py'}")
    print('Perps readiness + adapter scaffold summary')
    for line in preflight.splitlines()[:8]:
        print(f'- {line}')
    for line in dry_run.splitlines()[:6]:
        print(f'- {line}')


if __name__ == '__main__':
    main()
