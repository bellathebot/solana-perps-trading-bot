from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1


def connect(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _normalize_json(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return json.dumps(value, sort_keys=True)
    except Exception:
        return json.dumps({'raw': str(value)})


def _parse_json(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def init_db(db_path: Path | str) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    try:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS system_events (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'info',
                message TEXT,
                source TEXT,
                metadata_json TEXT,
                UNIQUE(ts, event_type, message)
            );

            CREATE TABLE IF NOT EXISTS risk_events (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                product_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'info',
                event_type TEXT NOT NULL,
                scope TEXT,
                scope_key TEXT,
                message TEXT,
                metadata_json TEXT
            );

            CREATE TABLE IF NOT EXISTS signal_candidates (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                source TEXT,
                symbol TEXT NOT NULL,
                signal_type TEXT NOT NULL,
                strategy_tag TEXT,
                side TEXT,
                product_type TEXT NOT NULL DEFAULT 'perps',
                market TEXT,
                price REAL,
                reference_level REAL,
                distance_pct REAL,
                liquidity REAL,
                quote_price_impact REAL,
                score REAL,
                regime_tag TEXT,
                decision_id TEXT,
                candidate_key TEXT UNIQUE,
                status TEXT,
                reason TEXT,
                metadata_json TEXT
            );

            CREATE TABLE IF NOT EXISTS perp_signal_candidates (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                asset TEXT NOT NULL,
                signal_type TEXT NOT NULL,
                side TEXT,
                entry_score REAL,
                edge_pct REAL,
                decision_id TEXT,
                status TEXT,
                reason TEXT,
                metadata_json TEXT,
                candidate_key TEXT UNIQUE
            );

            CREATE TABLE IF NOT EXISTS auto_trades (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT,
                mode TEXT,
                amount REAL,
                size_usd REAL,
                price_usd REAL,
                fill_price_usd REAL,
                realized_pnl_usd REAL,
                fees_usd REAL,
                funding_usd REAL,
                reason TEXT,
                strategy_tag TEXT,
                strategy_family TEXT,
                product_type TEXT NOT NULL DEFAULT 'perps',
                decision_id TEXT,
                signature TEXT,
                trade_key TEXT UNIQUE,
                metadata_json TEXT
            );

            CREATE TABLE IF NOT EXISTS perp_market_snapshots (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                asset TEXT NOT NULL,
                price_usd REAL,
                change_pct_24h REAL,
                high_usd_24h REAL,
                low_usd_24h REAL,
                volume_usd_24h REAL,
                open_interest_usd REAL,
                funding_rate REAL,
                raw_json TEXT,
                UNIQUE(ts, asset)
            );

            CREATE TABLE IF NOT EXISTS perp_account_snapshots (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                wallet_address TEXT NOT NULL,
                open_position_count INTEGER NOT NULL DEFAULT 0,
                open_notional_usd REAL,
                unrealized_pnl_usd REAL,
                realized_pnl_usd REAL,
                margin_used_usd REAL,
                equity_estimate_usd REAL,
                raw_json TEXT,
                UNIQUE(ts, wallet_address)
            );

            CREATE TABLE IF NOT EXISTS perp_positions (
                id INTEGER PRIMARY KEY,
                position_key TEXT NOT NULL UNIQUE,
                opened_ts TEXT,
                updated_ts TEXT,
                closed_ts TEXT,
                status TEXT,
                asset TEXT,
                side TEXT,
                collateral_token TEXT,
                entry_price_usd REAL,
                mark_price_usd REAL,
                liq_price_usd REAL,
                size_usd REAL,
                notional_usd REAL,
                margin_used_usd REAL,
                leverage REAL,
                take_profit_price REAL,
                stop_loss_price REAL,
                unrealized_pnl_usd REAL,
                realized_pnl_usd REAL,
                fees_usd REAL,
                funding_usd REAL,
                strategy_tag TEXT,
                mode TEXT,
                decision_id TEXT,
                source TEXT,
                raw_json TEXT
            );

            CREATE TABLE IF NOT EXISTS perp_orders (
                id INTEGER PRIMARY KEY,
                ts TEXT NOT NULL,
                order_key TEXT UNIQUE,
                position_key TEXT,
                asset TEXT,
                side TEXT,
                order_type TEXT,
                status TEXT,
                size_usd REAL,
                limit_price REAL,
                trigger_price REAL,
                slippage_bps REAL,
                mode TEXT,
                strategy_tag TEXT,
                decision_id TEXT,
                reason TEXT,
                signature TEXT,
                raw_json TEXT
            );

            CREATE TABLE IF NOT EXISTS perp_fills (
                id INTEGER PRIMARY KEY,
                fill_key TEXT UNIQUE,
                ts TEXT NOT NULL,
                position_key TEXT,
                order_key TEXT,
                asset TEXT,
                side TEXT,
                action TEXT,
                price_usd REAL,
                size_usd REAL,
                fees_usd REAL,
                funding_usd REAL,
                realized_pnl_usd REAL,
                mode TEXT,
                strategy_tag TEXT,
                decision_id TEXT,
                raw_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_signal_candidates_product_ts ON signal_candidates(product_type, ts);
            CREATE INDEX IF NOT EXISTS idx_signal_candidates_decision ON signal_candidates(decision_id);
            CREATE INDEX IF NOT EXISTS idx_perp_market_asset_ts ON perp_market_snapshots(asset, ts);
            CREATE INDEX IF NOT EXISTS idx_perp_positions_status ON perp_positions(status);
            CREATE INDEX IF NOT EXISTS idx_perp_orders_ts ON perp_orders(ts);
            CREATE INDEX IF NOT EXISTS idx_perp_fills_ts ON perp_fills(ts);
            CREATE INDEX IF NOT EXISTS idx_risk_events_ts ON risk_events(ts);
            CREATE INDEX IF NOT EXISTS idx_system_events_ts ON system_events(ts);
        ''')
        conn.execute(
            "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(SCHEMA_VERSION),),
        )
        conn.commit()
    finally:
        conn.close()


def record_system_event(db_path: Path | str, event: dict) -> int | None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        cur = conn.execute(
            "INSERT OR IGNORE INTO system_events(ts, event_type, severity, message, source, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
            (event.get('ts'), event.get('event_type'), event.get('severity', 'info'), event.get('message'), event.get('source'), _normalize_json(event.get('metadata'))),
        )
        event_id = int(cur.lastrowid) if cur.lastrowid else None
        if event_id is None:
            row = conn.execute(
                "SELECT id FROM system_events WHERE ts = ? AND event_type = ? AND message = ? ORDER BY id DESC LIMIT 1",
                (event.get('ts'), event.get('event_type'), event.get('message')),
            ).fetchone()
            event_id = int(row['id']) if row else None
        conn.commit()
        return event_id
    finally:
        conn.close()


def record_risk_event(db_path: Path | str, payload: dict) -> None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        conn.execute(
            "INSERT INTO risk_events(ts, product_type, severity, event_type, scope, scope_key, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                payload.get('ts'), payload.get('product_type', 'perps'), payload.get('severity', 'info'), payload.get('event_type'),
                payload.get('scope'), payload.get('scope_key'), payload.get('message'), _normalize_json(payload.get('metadata')),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def record_signal_candidate(db_path: Path | str, candidate: dict) -> None:
    init_db(db_path)
    product_type = candidate.get('product_type', candidate.get('productType', 'perps'))
    metadata = candidate.get('metadata', candidate.get('metadata_json')) or {}
    candidate_key = candidate.get('candidate_key', candidate.get('candidateKey'))
    conn = connect(db_path)
    try:
        params = (
            candidate.get('ts'), candidate.get('source'), candidate.get('symbol'), candidate.get('signal_type'),
            candidate.get('strategy_tag', candidate.get('strategyTag')), candidate.get('side'), product_type,
            candidate.get('market'), candidate.get('price'), candidate.get('reference_level', candidate.get('referenceLevel')),
            candidate.get('distance_pct', candidate.get('distancePct')), candidate.get('liquidity'),
            candidate.get('quote_price_impact', candidate.get('quotePriceImpact')), candidate.get('score'),
            candidate.get('regime_tag', candidate.get('regimeTag')), candidate.get('decision_id', candidate.get('decisionId')),
            candidate_key, candidate.get('status', 'observed'), candidate.get('reason'), _normalize_json(metadata),
        )
        conn.execute(
            '''
            INSERT INTO signal_candidates(
                ts, source, symbol, signal_type, strategy_tag, side, product_type, market, price,
                reference_level, distance_pct, liquidity, quote_price_impact, score, regime_tag, decision_id,
                candidate_key, status, reason, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(candidate_key) DO UPDATE SET
                ts=excluded.ts, source=excluded.source, symbol=excluded.symbol, signal_type=excluded.signal_type,
                strategy_tag=excluded.strategy_tag, side=excluded.side, product_type=excluded.product_type,
                market=excluded.market, price=excluded.price, reference_level=excluded.reference_level,
                distance_pct=excluded.distance_pct, liquidity=excluded.liquidity,
                quote_price_impact=excluded.quote_price_impact, score=excluded.score,
                regime_tag=excluded.regime_tag, decision_id=excluded.decision_id,
                status=excluded.status, reason=excluded.reason, metadata_json=excluded.metadata_json
            ''',
            params,
        )
        if product_type == 'perps':
            edge_pct = metadata.get('edge_pct', metadata.get('edgePct', candidate.get('edge_pct', candidate.get('edgePct'))))
            conn.execute(
                '''
                INSERT INTO perp_signal_candidates(
                    ts, asset, signal_type, side, entry_score, edge_pct, decision_id, status, reason, metadata_json, candidate_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(candidate_key) DO UPDATE SET
                    ts=excluded.ts, asset=excluded.asset, signal_type=excluded.signal_type, side=excluded.side,
                    entry_score=excluded.entry_score, edge_pct=excluded.edge_pct, decision_id=excluded.decision_id,
                    status=excluded.status, reason=excluded.reason, metadata_json=excluded.metadata_json
                ''',
                (
                    candidate.get('ts'), candidate.get('symbol'), candidate.get('signal_type'), candidate.get('side'),
                    candidate.get('score'), edge_pct, candidate.get('decision_id', candidate.get('decisionId')),
                    candidate.get('status', 'observed'), candidate.get('reason'), _normalize_json(metadata),
                    candidate_key or f"{candidate.get('ts')}:{candidate.get('symbol')}:{candidate.get('signal_type')}:{candidate.get('status', 'observed')}",
                ),
            )
        conn.commit()
    finally:
        conn.close()


def record_auto_trade(db_path: Path | str, trade: dict) -> None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        trade_key = trade.get('trade_key') or trade.get('signature') or f"{trade.get('ts')}:{trade.get('symbol')}:{trade.get('side')}:{trade.get('mode')}"
        conn.execute(
            '''
            INSERT INTO auto_trades(
                ts, symbol, side, mode, amount, size_usd, price_usd, fill_price_usd, realized_pnl_usd,
                fees_usd, funding_usd, reason, strategy_tag, strategy_family, product_type, decision_id,
                signature, trade_key, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(trade_key) DO UPDATE SET
                ts=excluded.ts, symbol=excluded.symbol, side=excluded.side, mode=excluded.mode,
                amount=excluded.amount, size_usd=excluded.size_usd, price_usd=excluded.price_usd,
                fill_price_usd=excluded.fill_price_usd, realized_pnl_usd=excluded.realized_pnl_usd,
                fees_usd=excluded.fees_usd, funding_usd=excluded.funding_usd, reason=excluded.reason,
                strategy_tag=excluded.strategy_tag, strategy_family=excluded.strategy_family,
                product_type=excluded.product_type, decision_id=excluded.decision_id,
                signature=excluded.signature, metadata_json=excluded.metadata_json
            ''',
            (
                trade.get('ts'), trade.get('symbol'), trade.get('side'), trade.get('mode'), trade.get('amount'),
                trade.get('size_usd', trade.get('sizeUsd')), trade.get('price_usd', trade.get('priceUsd')),
                trade.get('fill_price_usd', trade.get('fillPriceUsd')), trade.get('realized_pnl_usd', trade.get('realizedPnlUsd')),
                trade.get('fees_usd', trade.get('feesUsd')), trade.get('funding_usd', trade.get('fundingUsd')),
                trade.get('reason'), trade.get('strategy_tag'), trade.get('strategy_family'),
                trade.get('product_type', 'perps'), trade.get('decision_id'), trade.get('signature'), trade_key,
                _normalize_json(trade.get('metadata', trade)),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def record_perp_market_snapshot(db_path: Path | str, snapshot: dict) -> None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        conn.execute(
            '''
            INSERT OR IGNORE INTO perp_market_snapshots(
                ts, asset, price_usd, change_pct_24h, high_usd_24h, low_usd_24h, volume_usd_24h, open_interest_usd, funding_rate, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                snapshot.get('ts'), snapshot.get('asset'), snapshot.get('priceUsd', snapshot.get('price_usd')),
                snapshot.get('changePct24h', snapshot.get('change_pct_24h')), snapshot.get('highUsd24h', snapshot.get('high_usd_24h')),
                snapshot.get('lowUsd24h', snapshot.get('low_usd_24h')), snapshot.get('volumeUsd24h', snapshot.get('volume_usd_24h')),
                snapshot.get('openInterestUsd', snapshot.get('open_interest_usd')), snapshot.get('fundingRate', snapshot.get('funding_rate')),
                _normalize_json(snapshot),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def record_perp_account_snapshot(db_path: Path | str, payload: dict) -> None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        conn.execute(
            '''
            INSERT OR REPLACE INTO perp_account_snapshots(
                ts, wallet_address, open_position_count, open_notional_usd, unrealized_pnl_usd,
                realized_pnl_usd, margin_used_usd, equity_estimate_usd, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                payload.get('ts'), payload.get('wallet_address') or 'unknown-wallet', payload.get('open_position_count', 0),
                payload.get('open_notional_usd', 0), payload.get('unrealized_pnl_usd', 0), payload.get('realized_pnl_usd'),
                payload.get('margin_used_usd'), payload.get('equity_estimate_usd'), _normalize_json(payload),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def upsert_perp_position(db_path: Path | str, payload: dict) -> None:
    init_db(db_path)
    key = payload.get('position_key') or payload.get('positionKey') or payload.get('pubkey') or payload.get('id')
    if not key:
        raise ValueError('position_key is required')
    conn = connect(db_path)
    try:
        conn.execute(
            '''
            INSERT INTO perp_positions(
                position_key, opened_ts, updated_ts, closed_ts, status, asset, side, collateral_token,
                entry_price_usd, mark_price_usd, liq_price_usd, size_usd, notional_usd, margin_used_usd, leverage,
                take_profit_price, stop_loss_price, unrealized_pnl_usd, realized_pnl_usd, fees_usd, funding_usd,
                strategy_tag, mode, decision_id, source, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(position_key) DO UPDATE SET
                opened_ts=excluded.opened_ts, updated_ts=excluded.updated_ts, closed_ts=excluded.closed_ts,
                status=excluded.status, asset=excluded.asset, side=excluded.side, collateral_token=excluded.collateral_token,
                entry_price_usd=excluded.entry_price_usd, mark_price_usd=excluded.mark_price_usd, liq_price_usd=excluded.liq_price_usd,
                size_usd=excluded.size_usd, notional_usd=excluded.notional_usd, margin_used_usd=excluded.margin_used_usd,
                leverage=excluded.leverage, take_profit_price=excluded.take_profit_price, stop_loss_price=excluded.stop_loss_price,
                unrealized_pnl_usd=excluded.unrealized_pnl_usd, realized_pnl_usd=excluded.realized_pnl_usd,
                fees_usd=excluded.fees_usd, funding_usd=excluded.funding_usd, strategy_tag=excluded.strategy_tag,
                mode=excluded.mode, decision_id=excluded.decision_id, source=excluded.source, raw_json=excluded.raw_json
            ''',
            (
                key, payload.get('opened_ts') or payload.get('openedTs') or payload.get('ts'),
                payload.get('updated_ts') or payload.get('updatedTs') or payload.get('ts'), payload.get('closed_ts') or payload.get('closedTs'),
                payload.get('status', 'open'), payload.get('asset'), payload.get('side'), payload.get('collateral_token') or payload.get('collateralToken'),
                payload.get('entry_price_usd', payload.get('entryPriceUsd')), payload.get('mark_price_usd', payload.get('markPriceUsd')),
                payload.get('liq_price_usd', payload.get('liqPriceUsd')), payload.get('size_usd', payload.get('sizeUsd')),
                payload.get('notional_usd', payload.get('notionalUsd')), payload.get('margin_used_usd', payload.get('marginUsedUsd')),
                payload.get('leverage'), payload.get('take_profit_price', payload.get('takeProfitPrice')),
                payload.get('stop_loss_price', payload.get('stopLossPrice')), payload.get('unrealized_pnl_usd', payload.get('unrealizedPnlUsd')),
                payload.get('realized_pnl_usd', payload.get('realizedPnlUsd')), payload.get('fees_usd', payload.get('feesUsd')),
                payload.get('funding_usd', payload.get('fundingUsd')), payload.get('strategy_tag'), payload.get('mode', 'paper'),
                payload.get('decision_id'), payload.get('source'), _normalize_json(payload),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def record_perp_order(db_path: Path | str, payload: dict) -> None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        conn.execute(
            '''
            INSERT OR REPLACE INTO perp_orders(
                ts, order_key, position_key, asset, side, order_type, status, size_usd, limit_price,
                trigger_price, slippage_bps, mode, strategy_tag, decision_id, reason, signature, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                payload.get('ts'), payload.get('order_key') or payload.get('orderKey') or payload.get('pubkey') or payload.get('id'),
                payload.get('position_key') or payload.get('positionKey'), payload.get('asset'), payload.get('side'),
                payload.get('order_type') or payload.get('orderType') or 'market', payload.get('status', 'observed'),
                payload.get('size_usd', payload.get('sizeUsd')), payload.get('limit_price', payload.get('limitPrice')),
                payload.get('trigger_price', payload.get('triggerPrice')), payload.get('slippage_bps', payload.get('slippageBps')),
                payload.get('mode', 'paper'), payload.get('strategy_tag'), payload.get('decision_id'), payload.get('reason'),
                payload.get('signature'), _normalize_json(payload),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _compute_fill_key(payload: dict) -> str:
    return payload.get('fill_key') or ':'.join([
        str(payload.get('ts') or ''),
        str(payload.get('position_key') or payload.get('positionKey') or ''),
        str(payload.get('order_key') or payload.get('orderKey') or ''),
        str(payload.get('asset') or ''),
        str(payload.get('action') or ''),
        str(payload.get('size_usd', payload.get('sizeUsd')) or ''),
    ])


def record_perp_fill(db_path: Path | str, payload: dict) -> None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        conn.execute(
            '''
            INSERT OR IGNORE INTO perp_fills(
                fill_key, ts, position_key, order_key, asset, side, action, price_usd, size_usd, fees_usd,
                funding_usd, realized_pnl_usd, mode, strategy_tag, decision_id, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                _compute_fill_key(payload), payload.get('ts'), payload.get('position_key') or payload.get('positionKey'),
                payload.get('order_key') or payload.get('orderKey'), payload.get('asset'), payload.get('side'), payload.get('action'),
                payload.get('price_usd', payload.get('priceUsd')), payload.get('size_usd', payload.get('sizeUsd')),
                payload.get('fees_usd', payload.get('feesUsd')), payload.get('funding_usd', payload.get('fundingUsd')),
                payload.get('realized_pnl_usd', payload.get('realizedPnlUsd')), payload.get('mode', 'paper'),
                payload.get('strategy_tag'), payload.get('decision_id'), _normalize_json(payload),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_perp_open_positions(db_path: Path | str) -> list[dict]:
    init_db(db_path)
    conn = connect(db_path)
    try:
        rows = conn.execute(
            '''
            SELECT position_key, opened_ts, updated_ts, closed_ts, status, asset, side, collateral_token,
                   entry_price_usd, mark_price_usd, liq_price_usd, size_usd, notional_usd, margin_used_usd, leverage,
                   take_profit_price, stop_loss_price, unrealized_pnl_usd, realized_pnl_usd, fees_usd, funding_usd,
                   strategy_tag, mode, decision_id, source
            FROM perp_positions
            WHERE status = 'open'
            ORDER BY ABS(COALESCE(notional_usd, size_usd, 0)) DESC, asset
            '''
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_perp_summary(db_path: Path | str, since_ts: str | None = None) -> dict:
    init_db(db_path)
    conn = connect(db_path)
    try:
        if since_ts is None:
            since_ts = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace('+00:00', 'Z')
        market_rows = conn.execute(
            '''
            SELECT pms.* FROM perp_market_snapshots pms
            JOIN (SELECT asset, MAX(ts) AS max_ts FROM perp_market_snapshots GROUP BY asset) latest
              ON latest.asset = pms.asset AND latest.max_ts = pms.ts
            ORDER BY asset
            '''
        ).fetchall()
        position_rows = conn.execute(
            '''
            SELECT asset, side, mode, leverage, size_usd, notional_usd, margin_used_usd, unrealized_pnl_usd,
                   realized_pnl_usd, liq_price_usd, mark_price_usd, position_key
            FROM perp_positions
            WHERE status = 'open'
            ORDER BY ABS(COALESCE(notional_usd, size_usd, 0)) DESC, asset
            '''
        ).fetchall()
        fill_rows = conn.execute(
            '''
            SELECT mode, COUNT(*) AS fill_count,
                   ROUND(COALESCE(SUM(size_usd), 0), 6) AS notional_usd,
                   ROUND(COALESCE(SUM(realized_pnl_usd), 0), 6) AS realized_pnl_usd,
                   ROUND(COALESCE(SUM(fees_usd), 0), 6) AS fees_usd,
                   ROUND(COALESCE(SUM(funding_usd), 0), 6) AS funding_usd
            FROM perp_fills WHERE ts >= ? GROUP BY mode ORDER BY mode
            ''',
            (since_ts,),
        ).fetchall()
        latest_account = conn.execute('SELECT * FROM perp_account_snapshots ORDER BY ts DESC LIMIT 1').fetchone()
        risk_rows = conn.execute(
            '''SELECT ts, product_type, severity, event_type, scope, scope_key, message FROM risk_events WHERE ts >= ? ORDER BY ts DESC LIMIT 20''',
            (since_ts,),
        ).fetchall()
        open_notional = sum(_to_float(r['notional_usd'] or r['size_usd']) for r in position_rows)
        unrealized = sum(_to_float(r['unrealized_pnl_usd']) for r in position_rows)
        avg_leverage = round(sum(_to_float(r['leverage']) for r in position_rows) / len(position_rows), 6) if position_rows else 0.0
        liquidation_buffers = []
        for r in position_rows:
            mark = _to_float(r['mark_price_usd'], 0.0)
            liq = _to_float(r['liq_price_usd'], 0.0)
            side = (r['side'] or '').lower()
            if mark and liq:
                if side in ('long', 'buy'):
                    liquidation_buffers.append(((mark - liq) / mark) * 100.0)
                elif side in ('short', 'sell'):
                    liquidation_buffers.append(((liq - mark) / mark) * 100.0)
        return {
            'markets': [dict(r) for r in market_rows],
            'open_positions': [dict(r) for r in position_rows],
            'trade_performance': [dict(r) for r in fill_rows],
            'risk_summary': {
                'open_position_count': len(position_rows),
                'open_notional_usd': round(open_notional, 6),
                'unrealized_pnl_usd': round(unrealized, 6),
                'avg_leverage': avg_leverage,
                'closest_liquidation_buffer_pct': round(min(liquidation_buffers), 6) if liquidation_buffers else None,
                'latest_account_snapshot': dict(latest_account) if latest_account else None,
                'recent_risk_events': [dict(r) for r in risk_rows],
            },
        }
    finally:
        conn.close()


def get_recent_perp_market_history(db_path: Path | str, minutes: int = 180, assets: list[str] | None = None, limit_per_asset: int = 120) -> dict:
    init_db(db_path)
    conn = connect(db_path)
    try:
        since_ts = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat().replace('+00:00', 'Z')
        rows = conn.execute(
            'SELECT ts, asset, price_usd, change_pct_24h, high_usd_24h, low_usd_24h, volume_usd_24h FROM perp_market_snapshots WHERE ts >= ? ORDER BY asset ASC, ts DESC',
            (since_ts,),
        ).fetchall()
        grouped = defaultdict(list)
        asset_filter = set(assets or [])
        for row in rows:
            asset = row['asset']
            if asset_filter and asset not in asset_filter:
                continue
            if len(grouped[asset]) >= limit_per_asset:
                continue
            grouped[asset].append(dict(row))
        return {'since_ts': since_ts, 'minutes': minutes, 'assets': {asset: list(reversed(items)) for asset, items in grouped.items()}}
    finally:
        conn.close()


def _future_price(conn: sqlite3.Connection, symbol: str, ts: str, minutes: int) -> float | None:
    try:
        upper_ts = (datetime.fromisoformat(ts.replace('Z', '+00:00')) + timedelta(minutes=minutes)).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except Exception:
        return None
    row = conn.execute(
        '''
        SELECT price_usd
        FROM perp_market_snapshots
        WHERE asset = ? AND ts > ? AND ts <= ?
        ORDER BY ts DESC LIMIT 1
        ''',
        (symbol, ts, upper_ts),
    ).fetchone()
    return _to_float(row['price_usd'], None) if row else None


def _candidate_forward_stats(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        '''
        SELECT ts, symbol, signal_type, side, price, score, metadata_json
        FROM signal_candidates
        WHERE COALESCE(product_type, 'perps') = 'perps'
          AND signal_type != 'perp_no_trade'
        ORDER BY ts DESC
        LIMIT 400
        '''
    ).fetchall()
    grouped = defaultdict(lambda: {'count': 0, 'wins': 0, 'sum_forward_return_pct': 0.0, 'sum_edge_after_costs': 0.0})
    for row in rows:
        price = _to_float(row['price'], None)
        future = _future_price(conn, row['symbol'], row['ts'], 60)
        if not price or future is None:
            continue
        side = (row['side'] or '').lower()
        forward_return = ((price - future) / price) * 100 if side == 'sell' else ((future - price) / price) * 100
        metadata = _parse_json(row['metadata_json'])
        edge_after_costs = _to_float(metadata.get('expected_edge_after_costs_pct'), 0.0)
        bucket = grouped[row['signal_type']]
        bucket['count'] += 1
        bucket['wins'] += 1 if forward_return > 0 else 0
        bucket['sum_forward_return_pct'] += forward_return
        bucket['sum_edge_after_costs'] += edge_after_costs
    summary = {}
    for signal_type, agg in grouped.items():
        count = agg['count']
        summary[signal_type] = {
            'candidate_count': count,
            'win_rate': round((agg['wins'] / count), 6) if count else 0.0,
            'avg_forward_return_pct': round((agg['sum_forward_return_pct'] / count), 6) if count else 0.0,
            'avg_edge_after_costs_pct': round((agg['sum_edge_after_costs'] / count), 6) if count else 0.0,
        }
    return summary


def get_strategy_execution_policy(db_path: Path | str, min_trades: int = 2, min_realized_pnl_usd: float = 0.0) -> dict:
    init_db(db_path)
    conn = connect(db_path)
    try:
        fills = conn.execute(
            '''
            SELECT strategy_tag, COUNT(*) AS fill_count, ROUND(COALESCE(SUM(realized_pnl_usd), 0), 6) AS realized_pnl_usd
            FROM perp_fills
            WHERE mode = 'paper'
            GROUP BY strategy_tag
            '''
        ).fetchall()
        fill_by_strategy = {row['strategy_tag']: dict(row) for row in fills}
        candidate_stats = _candidate_forward_stats(conn)
        breakdown = []
        paused = []
        for signal_type in sorted(set(list(candidate_stats.keys()) + list(fill_by_strategy.keys()))):
            fill_row = fill_by_strategy.get(signal_type, {})
            cand_row = candidate_stats.get(signal_type, {})
            item = {
                'strategy_tag': signal_type,
                'trade_count': int(fill_row.get('fill_count', 0) or 0),
                'realized_pnl_usd': _to_float(fill_row.get('realized_pnl_usd'), 0.0),
                'candidate_count': int(cand_row.get('candidate_count', 0) or 0),
                'win_rate': _to_float(cand_row.get('win_rate'), 0.0),
                'avg_forward_return_pct': _to_float(cand_row.get('avg_forward_return_pct'), 0.0),
                'avg_edge_after_costs_pct': _to_float(cand_row.get('avg_edge_after_costs_pct'), 0.0),
            }
            item['eligible_for_promotion'] = (
                item['candidate_count'] >= max(5, min_trades)
                and item['win_rate'] >= 0.52
                and item['avg_edge_after_costs_pct'] >= 0.05
                and item['realized_pnl_usd'] >= min_realized_pnl_usd
            )
            breakdown.append(item)
            if item['candidate_count'] >= max(5, min_trades) and (item['win_rate'] < 0.45 or item['avg_edge_after_costs_pct'] < 0):
                paused.append(item)

        best = conn.execute(
            '''
            SELECT symbol, signal_type, score, ts, metadata_json
            FROM signal_candidates
            WHERE COALESCE(product_type, 'perps') = 'perps' AND signal_type != 'perp_no_trade'
            ORDER BY ts DESC, score DESC LIMIT 1
            '''
        ).fetchone()
        best_meta = _parse_json(best['metadata_json']) if best else {}
        best_stats = next((row for row in breakdown if row['strategy_tag'] == best['signal_type']), None) if best else None
        approved = bool(best and best_stats and best_stats['eligible_for_promotion'])
        blockers = [] if approved else ['policy_thresholds_not_met']
        if best_stats and best_stats['candidate_count'] < max(5, min_trades):
            blockers.append('insufficient_sample_size')
        if best_stats and best_stats['avg_edge_after_costs_pct'] < 0.05:
            blockers.append('expected_edge_after_costs_below_threshold')
        if best_stats and best_stats['win_rate'] < 0.52:
            blockers.append('win_rate_below_threshold')
        return {
            'breakdown': breakdown,
            'paused_strategies': paused,
            'tiny_live_pilot_decision': {
                'approved': approved,
                'mode': 'paper',
                'product_type': 'perps',
                'strategy': best['signal_type'] if (approved and best) else 'perp_no_trade',
                'symbol': best['symbol'] if (approved and best) else None,
                'reason': 'approved_from_public_perps_db_impl' if (approved and best) else 'policy_thresholds_not_met',
                'blockers': blockers,
                'expected_edge_after_costs_pct': _to_float(best_meta.get('expected_edge_after_costs_pct'), 0.0),
                'score_gap_vs_no_trade': _to_float(best_meta.get('score_gap_vs_no_trade'), 0.0),
            },
        }
    finally:
        conn.close()


def get_perp_executor_state(db_path: Path | str, lookback_minutes: int = 240, analytics_lookback_hours: int = 24, recent_fill_limit: int = 25, recent_order_limit: int = 25, anchor_ts: str | None = None) -> dict:
    init_db(db_path)
    conn = connect(db_path)
    try:
        now = datetime.now(timezone.utc)
        anchor_dt = now
        if anchor_ts:
            try:
                anchor_dt = datetime.fromisoformat(anchor_ts.replace('Z', '+00:00')).astimezone(timezone.utc)
            except Exception:
                anchor_dt = now
        since_ts = (anchor_dt - timedelta(minutes=lookback_minutes)).isoformat().replace('+00:00', 'Z')
        day_start = anchor_dt.replace(hour=0, minute=0, second=0, microsecond=0).isoformat().replace('+00:00', 'Z')
        candidate_rows = conn.execute(
            '''
            SELECT ts, source, symbol, market, signal_type, strategy_tag, side, price, reference_level, distance_pct,
                   liquidity, quote_price_impact, score, regime_tag, decision_id, status, reason, metadata_json
            FROM signal_candidates
            WHERE ts >= ? AND COALESCE(product_type, 'perps') = 'perps' AND decision_id IS NOT NULL
              AND signal_type IN ('perp_short_continuation', 'perp_short_failed_bounce', 'perp_long_continuation', 'perp_long_breakout_retest', 'perp_no_trade')
            ORDER BY ts DESC, decision_id, score DESC
            ''',
            (since_ts,),
        ).fetchall()
        grouped = defaultdict(list)
        for row in candidate_rows:
            grouped[row['decision_id']].append(row)
        decisions = []
        competition_map = defaultdict(lambda: {'sum_score': 0.0, 'count': 0})
        for decision_id, rows in grouped.items():
            lanes = []
            best_short_lane = None
            best_action_lane = None
            rep = rows[0]
            for row in rows:
                lane = dict(row)
                lane['metadata'] = _parse_json(row['metadata_json'])
                lanes.append(lane)
                if lane['signal_type'] != 'perp_no_trade' and (best_action_lane is None or _to_float(lane.get('score')) > _to_float(best_action_lane.get('score'))):
                    best_action_lane = lane
                if lane['signal_type'] in ('perp_short_continuation', 'perp_short_failed_bounce'):
                    if best_short_lane is None or _to_float(lane.get('score')) > _to_float(best_short_lane.get('score')):
                        best_short_lane = lane
                if lane['signal_type'] != 'perp_no_trade':
                    key = (lane['symbol'], lane['signal_type'], 60)
                    competition_map[key]['sum_score'] += _to_float(lane.get('score'))
                    competition_map[key]['count'] += 1
            decisions.append({'decision_id': decision_id, 'ts': rep['ts'], 'symbol': rep['symbol'], 'market': rep['market'], 'regime_tag': rep['regime_tag'], 'price': rep['price'], 'lanes': lanes, 'best_short_lane': best_short_lane, 'best_action_lane': best_action_lane})
        decisions.sort(key=lambda x: x['ts'], reverse=True)
        latest_markets = [dict(r) for r in conn.execute(
            '''
            SELECT pms.asset, pms.ts, pms.price_usd, pms.change_pct_24h, pms.high_usd_24h, pms.low_usd_24h, pms.volume_usd_24h
            FROM perp_market_snapshots pms
            JOIN (SELECT asset, MAX(ts) AS max_ts FROM perp_market_snapshots GROUP BY asset) latest
              ON latest.asset = pms.asset AND latest.max_ts = pms.ts
            ORDER BY pms.asset
            '''
        ).fetchall()]
        open_positions = [dict(r) | {'raw': _parse_json(r['raw_json'])} for r in conn.execute(
            '''SELECT position_key, opened_ts, updated_ts, closed_ts, status, asset, side, collateral_token,
                      entry_price_usd, mark_price_usd, liq_price_usd, size_usd, notional_usd, margin_used_usd, leverage,
                      take_profit_price, stop_loss_price, unrealized_pnl_usd, realized_pnl_usd, fees_usd, funding_usd,
                      strategy_tag, mode, decision_id, source, raw_json
               FROM perp_positions WHERE status = 'open' AND mode = 'paper' ORDER BY ABS(COALESCE(notional_usd, size_usd, 0)) DESC, asset'''
        ).fetchall()]
        recent_orders = [dict(r) | {'raw': _parse_json(r['raw_json'])} for r in conn.execute(
            '''SELECT ts, order_key, position_key, asset, side, order_type, status, size_usd, limit_price, trigger_price,
                      slippage_bps, mode, strategy_tag, decision_id, reason, signature, raw_json
               FROM perp_orders WHERE mode = 'paper' ORDER BY ts DESC, id DESC LIMIT ?''',
            (recent_order_limit,),
        ).fetchall()]
        recent_fills = [dict(r) | {'raw': _parse_json(r['raw_json'])} for r in conn.execute(
            '''SELECT ts, position_key, order_key, asset, side, action, price_usd, size_usd, fees_usd, funding_usd,
                      realized_pnl_usd, mode, strategy_tag, decision_id, raw_json
               FROM perp_fills WHERE mode = 'paper' ORDER BY ts DESC, id DESC LIMIT ?''',
            (recent_fill_limit,),
        ).fetchall()]
        recent_risk_events = [dict(r) | {'metadata': _parse_json(r['metadata_json'])} for r in conn.execute(
            '''SELECT ts, product_type, severity, event_type, scope, scope_key, message, metadata_json
               FROM risk_events WHERE ts >= ? AND COALESCE(product_type, 'perps') = 'perps' ORDER BY ts DESC, id DESC LIMIT 25''',
            (day_start,),
        ).fetchall()]
        trade_metrics = conn.execute(
            '''SELECT COUNT(*) AS trade_count, ROUND(COALESCE(SUM(size_usd), 0), 6) AS notional_usd,
                      ROUND(COALESCE(SUM(realized_pnl_usd), 0), 6) AS realized_pnl_usd
               FROM auto_trades WHERE ts >= ? AND mode = 'paper' AND COALESCE(product_type, 'perps') = 'perps' ''',
            (day_start,),
        ).fetchone()
        competition = []
        for (symbol, signal_type, horizon), agg in competition_map.items():
            competition.append({'competition_scope': 'symbol', 'symbol': symbol, 'signal_type': signal_type, 'horizon_minutes': horizon, 'win_rate': 0.5, 'avg_edge_pct': round((agg['sum_score'] / agg['count']) / 100.0, 6) if agg['count'] else 0.0})
        return {
            'generated_ts': now.isoformat().replace('+00:00', 'Z'),
            'anchor_ts': anchor_dt.isoformat().replace('+00:00', 'Z'),
            'lookback_minutes': lookback_minutes,
            'day_start_ts': day_start,
            'decisions': decisions,
            'latest_markets': latest_markets,
            'open_positions': open_positions,
            'recent_orders': recent_orders,
            'recent_fills': recent_fills,
            'recent_risk_events': recent_risk_events,
            'recent_cycles': [],
            'latest_candidate_choice': {},
            'latest_pilot_policy': {},
            'best_current_opportunity': decisions[0] if decisions else {},
            'decision_readiness': {
                'pending_decision_count': len(decisions),
                'trade_ready_count': len([d for d in decisions if d.get('best_short_lane')]),
                'blocked_count': 0,
                'no_trade_selected_count': len([d for d in decisions if any(l.get('signal_type') == 'perp_no_trade' for l in d.get('lanes', []))]),
                'signal_age_limit_minutes': lookback_minutes,
                'top_blockers': [],
                'best_current_opportunity': decisions[0] if decisions else {},
                'top_opportunities': decisions[:5],
                'decisions': decisions,
            },
            'recent_entry_reason_counts': [],
            'recent_close_reason_counts': [],
            'daily_paper_metrics': {
                'trade_count': int(trade_metrics['trade_count'] or 0),
                'trade_notional_usd': _to_float(trade_metrics['notional_usd']),
                'fill_count': len(recent_fills),
                'fill_notional_usd': round(sum(_to_float(r.get('size_usd')) for r in recent_fills), 6),
                'realized_pnl_usd': _to_float(trade_metrics['realized_pnl_usd']),
                'fees_usd': round(sum(_to_float(r.get('fees_usd')) for r in recent_fills), 6),
                'funding_usd': round(sum(_to_float(r.get('funding_usd')) for r in recent_fills), 6),
            },
            'competition': competition,
        }
    finally:
        conn.close()


def _load_json_file(path: Path, default: Any) -> Any:
    try:
        if not path.exists():
            return default
        return json.loads(path.read_text())
    except Exception:
        return default


def sync_from_files(db_path: Path | str, data_dir: Path | str) -> dict:
    init_db(db_path)
    data_dir = Path(data_dir)
    counts = {'perp_market_snapshots': 0, 'perp_account_snapshots': 0, 'perp_positions': 0, 'perp_orders': 0, 'perp_fills': 0, 'perp_signal_candidates': 0, 'system_events': 0, 'risk_events': 0, 'auto_trades': 0}
    mapping = [
        ('perp_market_snapshots.json', record_perp_market_snapshot, 'perp_market_snapshots'),
        ('perp_account_snapshots.json', record_perp_account_snapshot, 'perp_account_snapshots'),
        ('perp_positions.json', upsert_perp_position, 'perp_positions'),
        ('perp_orders.json', record_perp_order, 'perp_orders'),
        ('perp_fills.json', record_perp_fill, 'perp_fills'),
        ('perp_signal_candidates.json', record_signal_candidate, 'perp_signal_candidates'),
        ('auto_trades.json', record_auto_trade, 'auto_trades'),
        ('system_events.json', record_system_event, 'system_events'),
        ('risk_events.json', record_risk_event, 'risk_events'),
    ]
    for filename, fn, key in mapping:
        payload = _load_json_file(data_dir / filename, [])
        if isinstance(payload, dict):
            payload = payload.get('items', [])
        for item in payload or []:
            try:
                fn(db_path, item)
                counts[key] += 1
            except Exception:
                continue
    return counts
