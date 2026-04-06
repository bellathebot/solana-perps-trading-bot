# Example commands

## Sync runtime files into SQLite

```bash
PYTHONPATH=. python trading_system/perps_sync_db.py --db ~/.trading-data/trading.db --data-dir ~/.trading-data
```

## Perp summary

```bash
PYTHONPATH=. python trading_system/perps_db_cli.py perp-summary --db ~/.trading-data/trading.db
```

## Recent perps executor state

```bash
PYTHONPATH=. python trading_system/perps_db_cli.py perp-executor-state --db ~/.trading-data/trading.db --minutes 240
```

## Record a perp market snapshot from JSON

```bash
PYTHONPATH=. python trading_system/perps_db_cli.py record-perp-market-snapshot --db ~/.trading-data/trading.db < examples/sample_record_perp_market_snapshot.json
```

## Record a perp candidate from JSON

```bash
PYTHONPATH=. python trading_system/perps_db_cli.py record-perp-candidate --db ~/.trading-data/trading.db < examples/sample_record_perp_candidate.json
```

## Record a perp risk event from JSON

```bash
PYTHONPATH=. python trading_system/perps_db_cli.py record-risk-event --db ~/.trading-data/trading.db < examples/sample_record_risk_event.json
```
