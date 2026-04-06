#!/usr/bin/env python3
import argparse
import json
import sqlite3
from pathlib import Path

from trading_system.runtime_config import DB_PATH


def connect(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def q1(conn, sql, args=()):
    row = conn.execute(sql, args).fetchone()
    return dict(row) if row else {}


def qall(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def fmt_money(v):
    try:
        return f"${float(v or 0):.2f}"
    except Exception:
        return '$0.00'


def main() -> None:
    parser = argparse.ArgumentParser(description='Print perps-focused trading analytics from SQLite')
    parser.add_argument('--db', default=str(DB_PATH))
    parser.add_argument('--since-ts', default=None)
    args = parser.parse_args()

    db = Path(args.db)
    since_ts = args.since_ts or '1970-01-01T00:00:00Z'

    conn = connect(db)
    try:
        latest_account = q1(conn, """
            SELECT ts, wallet_address, open_position_count, open_notional_usd, unrealized_pnl_usd,
                   realized_pnl_usd, margin_used_usd, equity_estimate_usd
            FROM perp_account_snapshots
            ORDER BY ts DESC LIMIT 1
        """)
        open_positions = qall(conn, """
            SELECT asset, side, status, notional_usd, entry_price_usd, mark_price_usd,
                   unrealized_pnl_usd, leverage, strategy_tag, mode, updated_ts
            FROM perp_positions
            WHERE COALESCE(status, 'open') = 'open'
            ORDER BY updated_ts DESC, id DESC
            LIMIT 20
        """)
        candidate_summary = qall(conn, """
            SELECT signal_type, asset, COUNT(*) AS candidate_count,
                   ROUND(AVG(COALESCE(entry_score, 0)), 2) AS avg_entry_score,
                   ROUND(AVG(COALESCE(edge_pct, 0)), 4) AS avg_edge_pct,
                   MAX(ts) AS latest_ts
            FROM perp_signal_candidates
            WHERE ts >= ?
            GROUP BY signal_type, asset
            ORDER BY latest_ts DESC, candidate_count DESC
            LIMIT 20
        """, (since_ts,))
        fill_summary = qall(conn, """
            SELECT mode, asset,
                   COUNT(*) AS fill_count,
                   ROUND(SUM(COALESCE(realized_pnl_usd, 0)), 6) AS realized_pnl_usd,
                   ROUND(SUM(COALESCE(size_usd, 0)), 6) AS notional_usd
            FROM perp_fills
            WHERE ts >= ?
            GROUP BY mode, asset
            ORDER BY fill_count DESC, asset ASC
            LIMIT 20
        """, (since_ts,))
        recent_risk = qall(conn, """
            SELECT ts, event_type, severity, message
            FROM risk_events
            WHERE ts >= ? AND COALESCE(product_type, 'perps') = 'perps'
            ORDER BY ts DESC, id DESC
            LIMIT 12
        """, (since_ts,))
        recent_system = qall(conn, """
            SELECT ts, event_type, severity, message
            FROM system_events
            WHERE ts >= ? AND (
                COALESCE(source, '') = 'perps-auto-trade.mjs'
                OR event_type LIKE 'perp_%'
            )
            ORDER BY ts DESC, id DESC
            LIMIT 12
        """, (since_ts,))
        market_summary = qall(conn, """
            SELECT asset,
                   MAX(ts) AS latest_ts,
                   ROUND(AVG(COALESCE(price_usd, 0)), 6) AS avg_price_usd,
                   ROUND(AVG(COALESCE(change_pct_24h, 0)), 4) AS avg_change_pct_24h,
                   ROUND(AVG(COALESCE(volume_usd_24h, 0)), 2) AS avg_volume_usd_24h
            FROM perp_market_snapshots
            WHERE ts >= ?
            GROUP BY asset
            ORDER BY latest_ts DESC
            LIMIT 10
        """, (since_ts,))

        print('Perps trading analytics')
        print(f'Since: {since_ts}')

        print()
        print('Latest perp account snapshot:')
        if latest_account:
            print(
                f"- ts={latest_account.get('ts')} open_positions={latest_account.get('open_position_count', 0)} "
                f"open_notional={fmt_money(latest_account.get('open_notional_usd'))} "
                f"unrealized={fmt_money(latest_account.get('unrealized_pnl_usd'))} "
                f"realized={fmt_money(latest_account.get('realized_pnl_usd'))} "
                f"margin_used={fmt_money(latest_account.get('margin_used_usd'))}"
            )
        else:
            print('- none')

        print()
        print('Open perp positions:')
        if open_positions:
            for row in open_positions:
                print(
                    f"- {row.get('asset')} {row.get('side')} mode={row.get('mode')} strategy={row.get('strategy_tag')} "
                    f"notional={fmt_money(row.get('notional_usd'))} entry={row.get('entry_price_usd')} mark={row.get('mark_price_usd')} "
                    f"unrealized={fmt_money(row.get('unrealized_pnl_usd'))} lev={row.get('leverage')}"
                )
        else:
            print('- none')

        print()
        print('Perp candidate summary:')
        if candidate_summary:
            for row in candidate_summary:
                print(
                    f"- {row.get('asset')} {row.get('signal_type')}: n={row.get('candidate_count')} "
                    f"avg_score={row.get('avg_entry_score')} avg_edge_pct={row.get('avg_edge_pct')} latest={row.get('latest_ts')}"
                )
        else:
            print('- none')

        print()
        print('Perp fills by asset/mode:')
        if fill_summary:
            for row in fill_summary:
                print(
                    f"- {row.get('asset')} {row.get('mode')}: fills={row.get('fill_count')} "
                    f"notional={fmt_money(row.get('notional_usd'))} realized={fmt_money(row.get('realized_pnl_usd'))}"
                )
        else:
            print('- none')

        print()
        print('Perp market summary:')
        if market_summary:
            for row in market_summary:
                print(
                    f"- {row.get('asset')}: avg_price={row.get('avg_price_usd')} avg_24h_change={row.get('avg_change_pct_24h')}% "
                    f"avg_24h_volume={fmt_money(row.get('avg_volume_usd_24h'))} latest={row.get('latest_ts')}"
                )
        else:
            print('- none')

        print()
        print('Recent perps risk events:')
        if recent_risk:
            for row in recent_risk[:10]:
                print(f"- [{row.get('severity')}] {row.get('ts')} {row.get('event_type')}: {row.get('message')}")
        else:
            print('- none')

        print()
        print('Recent perps system events:')
        if recent_system:
            for row in recent_system[:10]:
                print(f"- [{row.get('severity')}] {row.get('ts')} {row.get('event_type')}: {row.get('message')}")
        else:
            print('- none')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
