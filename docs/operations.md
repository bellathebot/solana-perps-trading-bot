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
- `perps_db_impl.py` is the standalone public perps DB implementation layer.
- `perps_core.py` is the smaller public perps-facing Python module surface.
- `perps_db_cli.py` is the intended public perps-only CLI surface.
- `examples/commands.md` contains copy/paste public CLI examples.

## Validation shortcut

```bash
npm run validate
```

- `perps-signal-engine.mjs` contains the richer feature and lane-generation logic used by the monitor.
