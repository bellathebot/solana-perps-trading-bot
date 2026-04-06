#!/usr/bin/env python3
"""Compatibility stub for the public perps export.

The broader internal runtime historically exposed spot-accounting audit helpers
through `trading_system.accounting_audit`. The public perps repo does not ship
that spot-only audit workflow, but the shared SQLite layer still imports this
symbol.
"""

from pathlib import Path


def get_accounting_audit(db_path: Path | str) -> dict:
    return {
        'available': False,
        'reason': 'spot_accounting_audit_not_included_in_public_perps_export',
        'db_path': str(db_path),
    }
