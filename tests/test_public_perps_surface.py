import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PublicPerpsSurfaceTests(unittest.TestCase):
    def test_perps_db_cli_summary_on_empty_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'test.db'
            result = subprocess.run(
                ['python', str(ROOT / 'trading_system' / 'perps_db_cli.py'), 'perp-summary', '--db', str(db_path)],
                capture_output=True,
                text=True,
                env={**os.environ, 'PYTHONPATH': str(ROOT)},
                check=True,
            )
            payload = json.loads(result.stdout)
            self.assertIn('markets', payload)
            self.assertIn('open_positions', payload)
            self.assertIn('risk_summary', payload)

    def test_perps_db_cli_recent_system_events_on_empty_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'test.db'
            result = subprocess.run(
                ['python', str(ROOT / 'trading_system' / 'perps_db_cli.py'), 'recent-system-events', '--db', str(db_path)],
                capture_output=True,
                text=True,
                env={**os.environ, 'PYTHONPATH': str(ROOT)},
                check=True,
            )
            payload = json.loads(result.stdout)
            self.assertEqual(payload, [])


    def test_perps_db_cli_strategy_controls_on_empty_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'test.db'
            result = subprocess.run(
                ['python', str(ROOT / 'trading_system' / 'perps_db_cli.py'), 'strategy-controls', '--db', str(db_path)],
                capture_output=True,
                text=True,
                env={**os.environ, 'PYTHONPATH': str(ROOT)},
                check=True,
            )
            payload = json.loads(result.stdout)
            self.assertIn('tiny_live_pilot_decision', payload)
            self.assertIn('approved', payload['tiny_live_pilot_decision'])

    def test_perps_sync_db_handles_empty_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'test.db'
            data_dir = Path(tmp) / 'data'
            data_dir.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(
                ['python', str(ROOT / 'trading_system' / 'perps_sync_db.py'), '--db', str(db_path), '--data-dir', str(data_dir)],
                capture_output=True,
                text=True,
                env={**os.environ, 'PYTHONPATH': str(ROOT)},
                check=True,
            )
            self.assertIn('Perps DB sync complete', result.stdout)


    def test_signal_engine_emits_long_lane_for_uptrend_fixture(self):
        node_code = """
import { computePerpsDecision } from './perps-signal-engine.mjs';
const now = new Date('2026-04-06T00:00:00.000Z').toISOString();
const market = { asset: 'SOL', priceUsd: 100, changePct24h: 6, volumeUsd24h: 200000000 };
const historyRows = [
  { ts: '2026-04-05T23:00:00.000Z', price_usd: 95, volume_usd_24h: 100000000 },
  { ts: '2026-04-05T23:15:00.000Z', price_usd: 96, volume_usd_24h: 110000000 },
  { ts: '2026-04-05T23:30:00.000Z', price_usd: 97.5, volume_usd_24h: 120000000 },
  { ts: '2026-04-05T23:45:00.000Z', price_usd: 99, volume_usd_24h: 140000000 },
  { ts: '2026-04-06T00:00:00.000Z', price_usd: 100, volume_usd_24h: 160000000 },
];
const out = computePerpsDecision({ market, historyRows, ts: now, basketMetrics: { change15m: 0.3, change60m: 0.8 } });
console.log(JSON.stringify(out));
"""
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ['node', '--input-type=module', '-e', node_code],
                capture_output=True,
                text=True,
                cwd=str(ROOT),
                check=True,
            )
            payload = json.loads(result.stdout)
            signal_types = {lane['signalType'] for lane in payload['lanes']}
            self.assertIn('perp_long_continuation', signal_types)

    def test_impl_and_core_export_expected_symbols(self):
        import trading_system.perps_core as perps_core
        import trading_system.perps_db_impl as perps_db_impl
        required = {
            'get_perp_summary',
            'get_perp_open_positions',
            'get_perp_executor_state',
            'record_perp_market_snapshot',
            'record_perp_fill',
        }
        for name in required:
            self.assertTrue(hasattr(perps_core, name))
            self.assertTrue(hasattr(perps_db_impl, name))


if __name__ == '__main__':
    unittest.main()
