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
- `perps_db_cli.py` and `perps_sync_db.py` are perps-facing wrappers around the shared SQLite layer.
