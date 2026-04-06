#!/usr/bin/env python3
import argparse
from pathlib import Path

from trading_system.perps_db_impl import sync_from_files


def main() -> None:
    parser = argparse.ArgumentParser(description='Sync perps JSON/log data into SQLite.')
    from trading_system.runtime_config import DB_PATH, DATA_DIR
    parser.add_argument('--db', default=str(DB_PATH), help='Path to SQLite database')
    parser.add_argument('--data-dir', default=str(DATA_DIR), help='Directory containing perps JSON/log files')
    args = parser.parse_args()

    counts = sync_from_files(Path(args.db), Path(args.data_dir))
    print('Perps DB sync complete:')
    for key, value in counts.items():
        print(f'- {key}: {value}')


if __name__ == '__main__':
    main()
