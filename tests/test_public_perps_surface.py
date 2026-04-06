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
