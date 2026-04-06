#!/usr/bin/env node

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import { REPO_ROOT, JUP_BIN, DATA_DIR, DB_PATH, DB_CLI, PATH_ENV, DEFAULT_WALLET_ADDRESS } from './runtime-config.mjs';
import { computePerpsDecision, safeNumber } from './perps-signal-engine.mjs';

const WALLET = process.env.PERPS_WALLET_ADDRESS || DEFAULT_WALLET_ADDRESS;
const EFFECTIVE_JUP_BIN = JUP_BIN;
const EFFECTIVE_DATA_DIR = DATA_DIR;
const EFFECTIVE_DB_PATH = DB_PATH;
const EFFECTIVE_DB_CLI = DB_CLI;
const EFFECTIVE_PATH_ENV = PATH_ENV;
const PILOT_ASSETS = (process.env.PERPS_MONITOR_PILOT_ASSETS || 'SOL,BTC,ETH').split(',').map(s => s.trim()).filter(Boolean);
const PILOT_LOOKBACK_MINUTES = parseInt(process.env.PERPS_MONITOR_PILOT_LOOKBACK_MINUTES || '180', 10);

function ensureDataDir() {
  if (!fs.existsSync(EFFECTIVE_DATA_DIR)) fs.mkdirSync(EFFECTIVE_DATA_DIR, { recursive: true });
}

function execJson(cmd) {
  try {
    const raw = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, PATH: EFFECTIVE_PATH_ENV },
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
  const equityEstimate = Math.max(0, openNotional + unrealized + realized);
  return {
    ts,
    wallet_address: WALLET,
    open_position_count: positions.length,
    open_notional_usd: openNotional,
    unrealized_pnl_usd: unrealized,
    realized_pnl_usd: realized,
    margin_used_usd: marginUsed,
    equity_estimate_usd: equityEstimate,
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

function getPerpHistory(assets) {
  return readDbCli('perp-market-history', ['--minutes', String(PILOT_LOOKBACK_MINUTES), '--assets', assets.join(','), '--limit-per-asset', '240']);
}

function computeBasketMetrics(historyByAsset) {
  const returns15 = [];
  const returns60 = [];
  for (const rows of Object.values(historyByAsset || {})) {
    const history = Array.isArray(rows) ? rows : [];
    if (history.length < 2) continue;
    const latest = history[history.length - 1];
    const prev15 = history[Math.max(0, history.length - 4)] || history[0];
    const prev60 = history[0];
    const lastPrice = safeNumber(latest?.price_usd, 0);
    const price15 = safeNumber(prev15?.price_usd, lastPrice);
    const price60 = safeNumber(prev60?.price_usd, lastPrice);
    if (lastPrice > 0 && price15 > 0) returns15.push(((lastPrice - price15) / price15) * 100);
    if (lastPrice > 0 && price60 > 0) returns60.push(((lastPrice - price60) / price60) * 100);
  }
  const avg = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { change15m: avg(returns15), change60m: avg(returns60) };
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
      reference_level: decision.metrics.referencePrice,
      distance_pct: decision.metrics.distanceFromReferencePct,
      liquidity: Number(market.volumeUsd24h ?? market.volume_usd_24h ?? 0),
      score: lane.compositeScore,
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
        score_components: {
          eligibility_score: lane.eligibilityScore,
          setup_quality_score: lane.setupQualityScore,
          execution_quality_score: lane.executionQualityScore,
          composite_score: lane.compositeScore,
          score_gap_vs_no_trade: lane.scoreGapVsNoTrade,
        },
        metrics: decision.metrics,
        regime_family: decision.regimeTag,
        setup_family: lane.setupFamily,
        expected_edge_pct: lane.expectedEdgePct,
        expected_edge_after_costs_pct: lane.expectedEdgeAfterCostsPct,
        cost_hurdle_pct: lane.costHurdlePct,
        time_bucket: decision.metrics.timeBucket,
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
      const historyResponse = getPerpHistory(Array.from(pilotMarketMap.keys()));
      const historyByAsset = historyResponse.assets || {};
      const basketMetrics = computeBasketMetrics(historyByAsset);
      for (const [asset, market] of pilotMarketMap.entries()) {
        const decision = computePerpsDecision({ market, historyRows: historyByAsset[asset] || [], ts, basketMetrics });
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
