#!/usr/bin/env python3
"""Perps-facing wrapper around the shared SQLite CLI bridge.

This keeps the public repo surface more perps-specific while the underlying
shared analytics layer is still being separated from the broader runtime.
"""

from trading_system.trading_db_cli import main


if __name__ == '__main__':
    main()
