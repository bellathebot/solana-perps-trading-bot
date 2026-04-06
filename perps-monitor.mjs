#!/usr/bin/env node

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import { REPO_ROOT, JUP_BIN, DATA_DIR, DB_PATH, DB_CLI, PATH_ENV, DEFAULT_WALLET_ADDRESS } from './runtime-config.mjs';

const WALLET = process.env.PERPS_WALLET_ADDRESS || DEFAULT_WALLET_ADDRESS;
const EFFECTIVE_JUP_BIN = JUP_BIN;
const EFFECTIVE_DATA_DIR = DATA_DIR;
const EFFECTIVE_DB_PATH = DB_PATH;
const EFFECTIVE_DB_CLI = DB_CLI;
const EFFECTIVE_PATH_ENV = PATH_ENV;
const PILOT_ASSETS = (process.env.PERPS_MONITOR_PILOT_ASSETS || 'SOL,BTC,ETH').split(',').map(s => s.trim()).filter(Boolean);
const PILOT_LOOKBACK_MINUTES = parseInt(process.env.PERPS_MONITOR_PILOT_LOOKBACK_MINUTES || '180', 10);
const NO_TRADE_MIN_SHORT_EDGE_PCT = parseFloat(process.env.PERPS_MONITOR_NO_TRADE_MIN_SHORT_EDGE_PCT || '0.25');
const SHORT_SCORE_CANDIDATE_THRESHOLD = parseFloat(process.env.PERPS_MONITOR_SHORT_SCORE_CANDIDATE_THRESHOLD || '65');

function ensureDataDir() {
  if (!fs.existsSync(EFFECTIVE_DATA_DIR)) fs.mkdirSync(EFFECTIVE_DATA_DIR, { recursive: true });
}

function execJson(cmd) {
  try {
    const raw = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, PATH: PATH_ENV },
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(raw.trim());
  } catch (e) {
    try { return JSON.parse(e.stdout?.toString().trim()); } catch {}
    return null;
  }
}

function runDbCli(command, payload) {
  const result = spawnSync('python', [EFFECTIVE_DB_CLI, command, '--db', EFFECTIVE_DB_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: { ...process.env, PATH: EFFECTIVE_PATH_ENV, PYTHONPATH: REPO_ROOT },
    timeout: 30000,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `DB CLI ${command} failed`);
  }
  return result.stdout?.trim() || '';
}

function readDbCli(command, args = []) {
  const result = spawnSync('python', [EFFECTIVE_DB_CLI, command, '--db', EFFECTIVE_DB_PATH, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: EFFECTIVE_PATH_ENV, PYTHONPATH: REPO_ROOT },
    timeout: 30000,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `DB CLI ${command} failed`);
  }
  return JSON.parse(result.stdout || '{}');
}

function recordRiskEvent(eventType, severity, message, metadata = {}) {
  runDbCli('record-risk-event', {
    ts: new Date().toISOString(),
    product_type: 'perps',
    event_type: eventType,
    severity,
    scope: 'monitor',
    scope_key: 'perps-monitor.mjs',
    message,
    metadata,
  });
}

function getMarkets() {
  return execJson(`${EFFECTIVE_JUP_BIN} perps markets`);
}

function getPositions() {
  return execJson(`${EFFECTIVE_JUP_BIN} perps positions --address ${WALLET}`);
}

function getHistory(limit = 20) {
  return execJson(`${EFFECTIVE_JUP_BIN} perps history --address ${WALLET} --limit ${limit}`);
}

function summarizeAccount(ts, positionsPayload, historyPayload) {
  const positions = positionsPayload?.positions || [];
  const openNotional = positions.reduce((sum, p) => sum + Number(p.notionalUsd ?? p.sizeUsd ?? p.size ?? 0), 0);
  const unrealized = positions.reduce((sum, p) => sum + Number(p.unrealizedPnlUsd ?? p.unrealizedPnl ?? 0), 0);
  const realized = (historyPayload?.trades || []).reduce((sum, t) => sum + Number(t.realizedPnlUsd ?? t.realizedPnl ?? 0), 0);
  const marginUsed = positions.reduce((sum, p) => sum + Number(p.marginUsedUsd ?? p.collateralUsd ?? 0), 0);
  return {
    ts,
    wallet_address: WALLET,
    open_position_count: positions.length,
    open_notional_usd: openNotional,
    unrealized_pnl_usd: unrealized,
    realized_pnl_usd: realized,
    margin_used_usd: marginUsed,
    equity_estimate_usd: null,
    raw: { positionsPayload, historyPayload },
  };
}

function normalizePosition(ts, position) {
  return {
    ts,
    position_key: position.positionKey || position.pubkey || position.id || `${position.asset}-${position.side}`,
    opened_ts: position.openedTs || position.createdAt || ts,
    updated_ts: position.updatedTs || ts,
    closed_ts: position.closedTs || null,
    status: position.status || 'open',
    asset: position.asset,
    side: position.side,
    collateral_token: position.collateralToken || position.collateral || null,
    entry_price_usd: position.entryPriceUsd ?? position.entryPrice ?? null,
    mark_price_usd: position.markPriceUsd ?? position.markPrice ?? null,
    liq_price_usd: position.liqPriceUsd ?? position.liquidationPrice ?? null,
    size_usd: position.sizeUsd ?? null,
    notional_usd: position.notionalUsd ?? position.sizeUsd ?? null,
    margin_used_usd: position.marginUsedUsd ?? position.collateralUsd ?? null,
    leverage: position.leverage ?? null,
    take_profit_price: position.takeProfitPrice ?? null,
    stop_loss_price: position.stopLossPrice ?? null,
    unrealized_pnl_usd: position.unrealizedPnlUsd ?? position.unrealizedPnl ?? null,
    realized_pnl_usd: position.realizedPnlUsd ?? position.realizedPnl ?? null,
    fees_usd: position.feesUsd ?? null,
    funding_usd: position.fundingUsd ?? null,
    strategy_tag: 'perps_observed',
    mode: 'live',
    source: 'perps-monitor.mjs',
    raw: position,
  };
}

function normalizeOrder(ts, order) {
  return {
    ts,
    order_key: order.orderKey || order.pubkey || order.id || `${order.asset}-${order.side}-${ts}`,
    position_key: order.positionKey || null,
    asset: order.asset,
    side: order.side,
    order_type: order.orderType || order.type || 'market',
    status: order.status || 'observed',
    size_usd: order.sizeUsd ?? null,
    limit_price: order.limitPrice ?? null,
    trigger_price: order.triggerPrice ?? null,
    slippage_bps: order.slippageBps ?? null,
    mode: 'live',
    strategy_tag: 'perps_observed',
    reason: 'Observed open limit order via perps monitor',
    raw: order,
  };
}

function normalizeFill(ts, trade) {
  return {
    ts: trade.ts || trade.timestamp || ts,
    position_key: trade.positionKey || null,
    order_key: trade.orderKey || null,
    asset: trade.asset,
    side: trade.side,
    action: trade.action || 'observed',
    price_usd: trade.priceUsd ?? trade.price ?? null,
    size_usd: trade.sizeUsd ?? trade.notionalUsd ?? null,
    fees_usd: trade.feesUsd ?? null,
    funding_usd: trade.fundingUsd ?? null,
    realized_pnl_usd: trade.realizedPnlUsd ?? trade.realizedPnl ?? null,
    mode: 'live',
    strategy_tag: 'perps_observed',
    raw: trade,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferRegimeTag(change24h = 0) {
  if (change24h <= -8) return 'panic_selloff';
  if (change24h <= -3) return 'trend_down';
  if (change24h >= 5) return 'trend_up';
  if (Math.abs(change24h) >= 1.5) return 'choppy';
  return 'stable';
}

function getPerpHistory(assets) {
  return readDbCli('perp-market-history', ['--minutes', String(PILOT_LOOKBACK_MINUTES), '--assets', assets.join(','), '--limit-per-asset', '120']);
}

function latestPriceBefore(history, minutesBack) {
  if (!Array.isArray(history) || !history.length) return null;
  const targetTs = Date.now() - (minutesBack * 60 * 1000);
  let chosen = history[0];
  for (const row of history) {
    const ts = new Date(row.ts).getTime();
    if (ts <= targetTs) return row;
    chosen = row;
  }
  return chosen;
}

function pctChange(from, to) {
  if (!from || !to || !Number(from.price_usd) || !Number(to.price_usd)) return null;
  return ((Number(to.price_usd) - Number(from.price_usd)) / Number(from.price_usd)) * 100;
}

function stableDecisionBucket(ts, minutes = 5) {
  const bucketMs = minutes * 60 * 1000;
  const bucketStart = Math.floor(new Date(ts).getTime() / bucketMs) * bucketMs;
  return new Date(bucketStart).toISOString();
}

function computePilotDecision(market, historyRows, ts) {
  const history = historyRows || [];
  const latest = history[history.length - 1] || { price_usd: market.priceUsd ?? market.price_usd, ts };
  const priceNow = Number(latest.price_usd ?? market.priceUsd ?? market.price_usd ?? 0);
  const row5 = latestPriceBefore(history, 5);
  const row15 = latestPriceBefore(history, 15);
  const row60 = latestPriceBefore(history, 60);
  const change5m = pctChange(row5, latest) ?? 0;
  const change15m = pctChange(row15, latest) ?? 0;
  const change60m = pctChange(row60, latest) ?? 0;
  const low60 = history.length ? Math.min(...history.map(r => Number(r.low_usd_24h ?? r.price_usd ?? priceNow)).filter(Boolean)) : priceNow;
  const highRecent = history.length ? Math.max(...history.slice(-12).map(r => Number(r.price_usd ?? priceNow)).filter(Boolean)) : priceNow;
  const bouncePct = low60 > 0 ? ((priceNow - low60) / low60) * 100 : 0;
  const pullbackFromBounceHighPct = highRecent > 0 ? ((priceNow - highRecent) / highRecent) * 100 : 0;
  const change24h = Number(market.changePct24h ?? market.change_pct_24h ?? 0);
  const volume24h = Number(market.volumeUsd24h ?? market.volume_usd_24h ?? 0);
  const regimeTag = inferRegimeTag(change24h);

  const continuationComponents = {
    regime: (regimeTag === 'trend_down' ? 25 : regimeTag === 'panic_selloff' ? 20 : 0),
    change_15m: clamp(Math.abs(Math.min(change15m, 0)) * 8, 0, 20),
    change_60m: clamp(Math.abs(Math.min(change60m, 0)) * 6, 0, 20),
    volume: volume24h >= 100000000 ? 15 : volume24h >= 25000000 ? 10 : 5,
    overextension_penalty: change5m <= -1.5 ? -8 : 0,
  };
  const continuationScore = clamp(Math.round(Object.values(continuationComponents).reduce((sum, value) => sum + value, 0)), 0, 100);

  const failedBounceComponents = {
    regime: (regimeTag === 'panic_selloff' ? 30 : regimeTag === 'trend_down' ? 22 : 0),
    bounce_quality: clamp(Math.max(0, bouncePct) * 8, 0, 20),
    bounce_failure: clamp(Math.abs(Math.min(change5m, 0)) * 14, 0, 20),
    pullback_from_high: clamp(Math.abs(Math.min(pullbackFromBounceHighPct, 0)) * 12, 0, 15),
    volume: volume24h >= 100000000 ? 10 : volume24h >= 25000000 ? 6 : 3,
  };
  const failedBounceScore = clamp(Math.round(Object.values(failedBounceComponents).reduce((sum, value) => sum + value, 0)), 0, 100);

  const bestShortScore = Math.max(continuationScore, failedBounceScore);
  const minShortEdgeScore = clamp(Math.round(NO_TRADE_MIN_SHORT_EDGE_PCT * 100), 0, 100);
  const shortEdgeQualified = bestShortScore >= SHORT_SCORE_CANDIDATE_THRESHOLD && bestShortScore >= minShortEdgeScore;
  const noTradeScore = clamp(shortEdgeQualified ? 25 : Math.max(55, 85 - Math.round(bestShortScore / 2)), 0, 100);
  const decisionBucket = stableDecisionBucket(ts, 5);
  const decisionId = `tiny-live-perps:${market.asset}:${decisionBucket}`;

  return {
    ts,
    decisionId,
    regimeTag,
    priceNow,
    metrics: {
      change5m,
      change15m,
      change60m,
      change24h,
      bouncePct,
      pullbackFromBounceHighPct,
      volume24h,
      low60,
      highRecent,
    },
    lanes: [
      {
        signalType: 'perp_short_continuation',
        side: 'sell',
        score: continuationScore,
        status: continuationScore >= SHORT_SCORE_CANDIDATE_THRESHOLD && continuationScore >= minShortEdgeScore ? 'candidate' : 'skipped',
        reason: continuationScore >= SHORT_SCORE_CANDIDATE_THRESHOLD && continuationScore >= minShortEdgeScore ? 'trend_down_short_continuation' : 'continuation_below_threshold',
        scoreComponents: continuationComponents,
      },
      {
        signalType: 'perp_short_failed_bounce',
        side: 'sell',
        score: failedBounceScore,
        status: failedBounceScore >= SHORT_SCORE_CANDIDATE_THRESHOLD && failedBounceScore >= minShortEdgeScore ? 'candidate' : 'skipped',
        reason: failedBounceScore >= SHORT_SCORE_CANDIDATE_THRESHOLD && failedBounceScore >= minShortEdgeScore ? 'panic_or_downtrend_failed_bounce_short' : 'failed_bounce_below_threshold',
        scoreComponents: failedBounceComponents,
      },
      {
        signalType: 'perp_no_trade',
        side: 'flat',
        score: noTradeScore,
        status: 'candidate',
        reason: shortEdgeQualified ? 'monitor_short_lanes' : 'no_trade_when_edge_is_mixed',
        scoreComponents: {
          best_short_score: bestShortScore,
          min_short_edge_score: minShortEdgeScore,
          no_trade_floor: NO_TRADE_MIN_SHORT_EDGE_PCT,
          regime: regimeTag,
        },
      },
    ],
  };
}

function recordPerpPilotCandidates(decision, market) {
  for (const lane of decision.lanes) {
    runDbCli('record-perp-candidate', {
      ts: decision.ts,
      source: 'perps-monitor.mjs',
      symbol: market.asset,
      market: market.asset,
      signal_type: lane.signalType,
      strategy_tag: lane.signalType,
      side: lane.side,
      product_type: 'perps',
      price: decision.priceNow,
      reference_level: decision.metrics.highRecent,
      distance_pct: decision.metrics.pullbackFromBounceHighPct,
      liquidity: Number(market.volumeUsd24h ?? market.volume_usd_24h ?? 0),
      score: lane.score,
      regime_tag: decision.regimeTag,
      decision_id: decision.decisionId,
      candidate_key: `${decision.decisionId}:${lane.signalType}`,
      status: lane.status,
      reason: lane.reason,
      metadata: {
        strategy_family: 'tiny_live_pilot',
        decision_id: decision.decisionId,
        asset: market.asset,
        lookback_minutes: PILOT_LOOKBACK_MINUTES,
        no_trade_min_short_edge_pct: NO_TRADE_MIN_SHORT_EDGE_PCT,
        score_components: lane.scoreComponents,
        metrics: decision.metrics,
      },
    });
  }
}

async function main() {
  ensureDataDir();
  const ts = new Date().toISOString();
  try {
    const markets = getMarkets();
    const positionsPayload = getPositions() || { positions: [], limitOrders: [] };
    const historyPayload = getHistory(20) || { trades: [] };

    for (const market of markets || []) {
      runDbCli('record-perp-market-snapshot', { ts, ...market });
    }

    const accountSummary = summarizeAccount(ts, positionsPayload, historyPayload);
    runDbCli('record-perp-account-snapshot', accountSummary);

    for (const position of positionsPayload.positions || []) {
      runDbCli('record-perp-position', normalizePosition(ts, position));
    }

    for (const order of positionsPayload.limitOrders || []) {
      runDbCli('record-perp-order', normalizeOrder(ts, order));
    }

    for (const trade of historyPayload.trades || []) {
      runDbCli('record-perp-fill', normalizeFill(ts, trade));
    }

    const pilotMarketMap = new Map((markets || []).filter(m => PILOT_ASSETS.includes(m.asset)).map(m => [m.asset, m]));
    if (pilotMarketMap.size > 0) {
      const historyByAsset = getPerpHistory(Array.from(pilotMarketMap.keys())).assets || {};
      for (const [asset, market] of pilotMarketMap.entries()) {
        const decision = computePilotDecision(market, historyByAsset[asset] || [], ts);
        recordPerpPilotCandidates(decision, market);
      }
    }

    console.log(JSON.stringify({
      ts,
      markets_observed: (markets || []).length,
      open_positions: (positionsPayload.positions || []).length,
      open_limit_orders: (positionsPayload.limitOrders || []).length,
      history_trades: (historyPayload.trades || []).length,
      pilot_assets: Array.from(pilotMarketMap.keys()),
    }, null, 2));
  } catch (e) {
    try {
      recordRiskEvent('perps_monitor_error', 'warning', e.message, { wallet: WALLET });
    } catch {}
    console.error(`perps-monitor failed: ${e.message}`);
    process.exit(1);
  }
}

main();
