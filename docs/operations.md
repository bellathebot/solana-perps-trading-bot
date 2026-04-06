# Operations

## Common commands

```bash
node perps-monitor.mjs
node perps-auto-trade.mjs
PYTHONPATH=. python trading_system/perps_sync_db.py --db ~/.trading-data/trading.db --data-dir ~/.trading-data
PYTHONPATH=. python trading_system/daily_analytics_report.py --db ~/.trading-data/trading.db
PYTHONPATH=. python trading_system/perps_readiness_preflight.py
node trading_system/perps_live_execution_adapter_harness.mjs
./trading_system/run_perps_cycle.sh
```

## Notes

- The public repo keeps the perps-facing notifier and perps approval bridge.
- Spot-only operator review tooling was intentionally left out of this export.
- `perps_core.py` is the smaller public perps-facing Python module surface.
- `perps_db_cli.py` is the intended public perps-only CLI surface.
- `trading_db_cli.py` remains in the repo as a shared internal bridge dependency and may be further split later.

- `examples/commands.md` contains copy/paste public CLI examples.
