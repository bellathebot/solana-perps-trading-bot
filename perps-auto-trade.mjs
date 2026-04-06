#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import { adapterCapabilities, buildPerpLiveExecutionRequest, submitPerpLiveOrder } from './trading_system/perps_live_execution_adapter.mjs';
import { REPO_ROOT, DATA_DIR, DB_PATH, DB_CLI, PATH_ENV } from './runtime-config.mjs';

const EFFECTIVE_DATA_DIR = DATA_DIR;
const EFFECTIVE_DB_PATH = DB_PATH;
const EFFECTIVE_DB_CLI = DB_CLI;
const EFFECTIVE_PATH_ENV = PATH_ENV;
const LOCK_FILE = process.env.PERPS_AUTO_TRADE_LOCK_FILE || `${DATA_DIR}/perps_auto_trade.lock`;
const LOG_FILE = process.env.PERPS_AUTO_TRADE_LOG_FILE || `${EFFECTIVE_DATA_DIR}/perps_auto_trade.log`;
const KILL_SWITCH_FILE = process.env.PERPS_AUTO_TRADE_KILL_SWITCH_FILE || `${EFFECTIVE_DATA_DIR}/perps_auto_trader.disabled`;
const JOURNAL_FILE = process.env.PERPS_AUTO_TRADE_JOURNAL_FILE || `${EFFECTIVE_DATA_DIR}/perps_auto_trade_journal.json`;
const TELEGRAM_BRIDGE_DIR = process.env.PERPS_AUTO_TRADE_TELEGRAM_BRIDGE_DIR || `${EFFECTIVE_DATA_DIR}/telegram-bridge`;
const LIVE_APPROVAL_FILE = process.env.PERPS_AUTO_TRADE_LIVE_APPROVAL_FILE || `${TELEGRAM_BRIDGE_DIR}/perps_live_approval.json`;
const LIVE_COMMAND_FILE = process.env.PERPS_AUTO_TRADE_LIVE_COMMAND_FILE || `${TELEGRAM_BRIDGE_DIR}/perps_live_commands.json`;

const flags = new Set(process.argv.slice(2));
const LIVE_REQUESTED = flags.has('--live') || process.env.PERPS_AUTO_TRADE_MODE === 'live';
const LIVE_ALLOWED = process.env.PERPS_AUTO_TRADE_ALLOW_LIVE === '1';
const LIVE_ENABLED = LIVE_REQUESTED && LIVE_ALLOWED;
const MODE = 'paper';

const STRATEGY_FAMILY = 'tiny_live_pilot';
const EXECUTOR_SOURCE = 'perps-auto-trade.mjs';
const EXECUTOR_ALLOWLIST = new Set(['SOL', 'BTC', 'ETH']);

function envFloat(name, fallback, min = null, max = null) {
  const raw = process.env[name];
  const parsed = raw == null ? Number(fallback) : Number(raw);
  if (!Number.isFinite(parsed)) return Number(fallback);
  if (min != null && parsed < min) return min;
  if (max != null && parsed > max) return max;
  return parsed;
}

function envInt(name, fallback, min = null, max = null) {
  const raw = process.env[name];
  const parsed = raw == null ? parseInt(String(fallback), 10) : parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return parseInt(String(fallback), 10);
  if (min != null && parsed < min) return min;
  if (max != null && parsed > max) return max;
  return parsed;
}

const PAPER_NOTIONAL_USD = envFloat('PERPS_AUTO_TRADE_PAPER_NOTIONAL_USD', 3, 0.5, 10);
const MAX_PAPER_NOTIONAL_USD = envFloat('PERPS_AUTO_TRADE_MAX_PAPER_NOTIONAL_USD', 5, 0.5, 10);
const MAX_ONE_POSITION = 1;
const DAILY_LOSS_CAP_USD = Math.abs(envFloat('PERPS_AUTO_TRADE_DAILY_LOSS_CAP_USD', 1.5, 0.25, 10));
const MAX_DAILY_NOTIONAL_USD = envFloat('PERPS_AUTO_TRADE_MAX_DAILY_NOTIONAL_USD', 9, 1, 25);
const ENTRY_SCORE_THRESHOLD = envFloat('PERPS_AUTO_TRADE_MIN_ENTRY_SCORE', 72, 0, 100);
const CANDIDATE_LOOKBACK_MINUTES = envInt('PERPS_AUTO_TRADE_LOOKBACK_MINUTES', 240, 30, 1440);
const MAX_SIGNAL_AGE_MINUTES = envInt('PERPS_AUTO_TRADE_MAX_SIGNAL_AGE_MINUTES', 40, 5, 180);
const GLOBAL_COOLDOWN_MINUTES = envInt('PERPS_AUTO_TRADE_GLOBAL_COOLDOWN_MINUTES', 90, 0, 1440);
const SYMBOL_COOLDOWN_MINUTES = envInt('PERPS_AUTO_TRADE_SYMBOL_COOLDOWN_MINUTES', 180, 0, 1440);
const MAX_HOLD_MINUTES = envInt('PERPS_AUTO_TRADE_MAX_HOLD_MINUTES', 240, 15, 1440);
const MAX_MARKET_STALENESS_MINUTES = envInt('PERPS_AUTO_TRADE_MAX_MARKET_STALENESS_MINUTES', 20, 1, 240);
const BASE_STOP_PCT = envFloat('PERPS_AUTO_TRADE_BASE_STOP_PCT', 0.9, 0.2, 5);
const BASE_TARGET_PCT = envFloat('PERPS_AUTO_TRADE_BASE_TARGET_PCT', 1.8, 0.4, 10);
const INVALIDATION_BUFFER_PCT = envFloat('PERPS_AUTO_TRADE_INVALIDATION_BUFFER_PCT', 0.35, 0.05, 3);
const ESTIMATED_FEE_BPS = envFloat('PERPS_AUTO_TRADE_ESTIMATED_FEE_BPS', 6, 0, 50);
const ANALYTICS_LOOKBACK_HOURS = envInt('PERPS_AUTO_TRADE_ANALYTICS_LOOKBACK_HOURS', 24, 1, 168);
const STRATEGY_POLICY_MIN_TRADES = envInt('PERPS_AUTO_TRADE_STRATEGY_POLICY_MIN_TRADES', 2, 1, 1000);
const STRATEGY_POLICY_MIN_REALIZED_PNL_USD = envFloat('PERPS_AUTO_TRADE_STRATEGY_POLICY_MIN_REALIZED_PNL_USD', 0);
const MAX_QUOTE_DRIFT_BPS = envFloat('PERPS_AUTO_TRADE_MAX_QUOTE_DRIFT_BPS', 75, 1, 1000);
const JOURNAL_RETENTION_HOURS = envInt('PERPS_AUTO_TRADE_JOURNAL_RETENTION_HOURS', 168, 1, 24 * 30);
const SIMULATED_PARTIAL_FILL_PCT = envFloat('PERPS_AUTO_TRADE_SIMULATED_PARTIAL_FILL_PCT', 100, 1, 100);
const SIMULATED_RESPONSE_DRIFT_BPS = envFloat('PERPS_AUTO_TRADE_SIMULATED_RESPONSE_DRIFT_BPS', 0, -500, 500);
const SIMULATED_SUBMIT_TIMEOUT_MODE = String(process.env.PERPS_AUTO_TRADE_SIMULATED_SUBMIT_TIMEOUT_MODE || '').trim().toLowerCase();
const PAPER_EQUITY_USD = envFloat('PERPS_AUTO_TRADE_PAPER_EQUITY_USD', 25, 5, 1000);
const MAX_ACCOUNT_DRAWDOWN_PCT = envFloat('PERPS_AUTO_TRADE_MAX_ACCOUNT_DRAWDOWN_PCT', 8, 0.5, 80);
const MAX_TOTAL_OPEN_NOTIONAL_USD = envFloat('PERPS_AUTO_TRADE_MAX_TOTAL_OPEN_NOTIONAL_USD', MAX_PAPER_NOTIONAL_USD, 0.5, 100);
const MAX_NOTIONAL_TO_EQUITY_PCT = envFloat('PERPS_AUTO_TRADE_MAX_NOTIONAL_TO_EQUITY_PCT', 35, 1, 200);
const MAX_PLANNED_LEVERAGE = envFloat('PERPS_AUTO_TRADE_MAX_PLANNED_LEVERAGE', 1, 0.1, 25);
const MAX_ESTIMATED_SPREAD_BPS = envFloat('PERPS_AUTO_TRADE_MAX_ESTIMATED_SPREAD_BPS', 35, 1, 500);
const MAX_ESTIMATED_SLIPPAGE_BPS = envFloat('PERPS_AUTO_TRADE_MAX_ESTIMATED_SLIPPAGE_BPS', 45, 1, 1000);
const LIVE_STUB_NOTIONAL_USD = envFloat('PERPS_AUTO_TRADE_LIVE_STUB_NOTIONAL_USD', 1, 0.5, 10);
const LIVE_APPROVAL_TTL_MINUTES = envInt('PERPS_AUTO_TRADE_LIVE_APPROVAL_TTL_MINUTES', 30, 1, 1440);

function ensureDataDir() {
  if (!fs.existsSync(EFFECTIVE_DATA_DIR)) fs.mkdirSync(EFFECTIVE_DATA_DIR, { recursive: true });
  if (!fs.existsSync(TELEGRAM_BRIDGE_DIR)) fs.mkdirSync(TELEGRAM_BRIDGE_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function defaultJournal() {
  return {
    version: 2,
    actions: {},
    state: {
      equity: {
        baseline_equity_usd: PAPER_EQUITY_USD,
        peak_equity_usd: null,
        last_equity_usd: null,
        current_drawdown_pct: 0,
        max_drawdown_pct: 0,
        updated_ts: null,
      },
    },
  };
}

function ensureJournalShape(journal) {
  const next = journal && typeof journal === 'object' ? journal : {};
  next.version = Math.max(2, safeNumber(next.version, 0) || 0);
  next.actions = next.actions && typeof next.actions === 'object' ? next.actions : {};
  next.state = next.state && typeof next.state === 'object' ? next.state : {};
  next.state.equity = next.state.equity && typeof next.state.equity === 'object'
    ? next.state.equity
    : {};
  if (!Number.isFinite(safeNumber(next.state.equity.baseline_equity_usd, null))) {
    next.state.equity.baseline_equity_usd = PAPER_EQUITY_USD;
  }
  if (!Number.isFinite(safeNumber(next.state.equity.current_drawdown_pct, null))) {
    next.state.equity.current_drawdown_pct = 0;
  }
  if (!Number.isFinite(safeNumber(next.state.equity.max_drawdown_pct, null))) {
    next.state.equity.max_drawdown_pct = 0;
  }
  return next;
}

function loadJournal() {
  ensureDataDir();
  if (!fs.existsSync(JOURNAL_FILE)) return defaultJournal();
  try {
    const parsed = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf-8'));
    return ensureJournalShape(parsed && typeof parsed === 'object' ? parsed : defaultJournal());
  } catch (err) {
    log(`failed to parse executor journal; starting fresh: ${err.message}`);
    return defaultJournal();
  }
}

function saveJournal(journal) {
  ensureDataDir();
  const normalized = ensureJournalShape(journal);
  const tmpPath = `${JOURNAL_FILE}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmpPath, JOURNAL_FILE);
}

function pruneJournal(journal) {
  const cutoffMs = Date.now() - (JOURNAL_RETENTION_HOURS * 60 * 60 * 1000);
  for (const [actionKey, action] of Object.entries(journal.actions || {})) {
    const updatedMs = new Date(action.updated_ts || action.created_ts || 0).getTime();
    if (Number.isFinite(updatedMs) && updatedMs > 0 && updatedMs < cutoffMs && action.terminal) {
      delete journal.actions[actionKey];
    }
  }
}

function mergeUnique(existing, incoming) {
  const values = [];
  for (const item of [...(existing || []), ...(incoming || [])]) {
    if (item == null || item === '') continue;
    if (!values.includes(item)) values.push(item);
  }
  return values;
}

function readJsonFile(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function actionIsTerminal(action) {
  return Boolean(action?.terminal);
}

function upsertJournalAction(journal, actionKey, patch = {}) {
  const existing = journal.actions?.[actionKey] || {};
  const next = {
    created_ts: existing.created_ts || patch.created_ts || nowIso(),
    action_key: actionKey,
    ...existing,
    ...patch,
    submitted_order_ids: mergeUnique(existing.submitted_order_ids, patch.submitted_order_ids),
    fill_ids: mergeUnique(existing.fill_ids, patch.fill_ids),
    recovery_notes: mergeUnique(existing.recovery_notes, patch.recovery_notes),
    updated_ts: patch.updated_ts || nowIso(),
  };
  next.terminal = patch.terminal != null ? Boolean(patch.terminal) : Boolean(existing.terminal);
  journal.actions[actionKey] = next;
  pruneJournal(journal);
  saveJournal(journal);
  return next;
}

function summarizeJournalAction(action) {
  if (!action) return null;
  return {
    action_key: action.action_key,
    action_type: action.action_type || null,
    status: action.status || null,
    symbol: action.symbol || null,
    decision_id: action.decision_id || null,
    position_key: action.position_key || null,
    submitted_order_ids: action.submitted_order_ids || [],
    fill_ids: action.fill_ids || [],
    last_risk_decision: action.last_risk_decision || null,
    current_position_state: action.current_position_state || null,
    recovery_notes: action.recovery_notes || [],
    terminal: Boolean(action.terminal),
    updated_ts: action.updated_ts || null,
  };
}

function defaultLiveApprovalIntent() {
  return { version: 1, status: 'idle' };
}

function loadLiveApprovalIntent() {
  return readJsonFile(LIVE_APPROVAL_FILE, defaultLiveApprovalIntent()) || defaultLiveApprovalIntent();
}

function saveLiveApprovalIntent(intent) {
  ensureDataDir();
  fs.writeFileSync(LIVE_APPROVAL_FILE, JSON.stringify(intent, null, 2));
}

function defaultLiveCommandState() {
  return { version: 1, command: null };
}

function loadLiveCommandState() {
  return readJsonFile(LIVE_COMMAND_FILE, defaultLiveCommandState()) || defaultLiveCommandState();
}

function saveLiveCommandState(state) {
  ensureDataDir();
  fs.writeFileSync(LIVE_COMMAND_FILE, JSON.stringify(state, null, 2));
}

function buildLiveApprovalIntent(plan, choice, policyContext) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LIVE_APPROVAL_TTL_MINUTES * 60000);
  return {
    version: 1,
    approval_id: `perp-approval:${plan.decisionId}`,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: 'pending',
    requested_mode: 'live',
    active_mode: MODE,
    symbol: plan.symbol,
    decision_id: plan.decisionId,
    signal_type: plan.signalType,
    strategy: choice?.plan?.signalType || plan.signalType,
    size_usd: Math.min(plan.paperNotional, LIVE_STUB_NOTIONAL_USD),
    entry_price: plan.entryPrice,
    stop_loss_price: plan.stopLossPrice,
    take_profit_price: plan.takeProfitPrice,
    invalidation_price: plan.invalidationPrice,
    composite_score: plan.compositeScore,
    candidate_choice: summarizeCandidateChoice(choice),
    pilot_policy: policyContext,
    commands: {
      approve: `APPROVE_PERP perp-approval:${plan.decisionId}`,
      reject: `REJECT_PERP perp-approval:${plan.decisionId}`,
      flatten_all: 'FLATTEN_PERP ALL',
    },
  };
}

function approvalIntentIsValid(intent) {
  if (!intent || !intent.status) return false;
  if (!['pending', 'approved'].includes(intent.status)) return false;
  if (!intent.expires_at) return true;
  return new Date(intent.expires_at).getTime() > Date.now();
}

function markApprovalIntentTerminal(intent, status, patch = {}) {
  const next = { ...intent, ...patch, status, resolved_at: nowIso() };
  saveLiveApprovalIntent(next);
  return next;
}

function prepareLiveApprovalIntent(plan, choice, policyContext) {
  const existing = loadLiveApprovalIntent();
  if (approvalIntentIsValid(existing) && existing.decision_id === plan.decisionId) return existing;
  if (approvalIntentIsValid(existing) && existing.decision_id && existing.decision_id !== plan.decisionId) {
    markApprovalIntentTerminal(existing, 'superseded', { superseded_by: plan.decisionId });
  }
  const intent = buildLiveApprovalIntent(plan, choice, policyContext);
  saveLiveApprovalIntent(intent);
  recordSystemEvent('perp_live_approval_requested', 'info', `Telegram approval required before tiny live perp entry on ${plan.symbol}`, {
    strategy_family: STRATEGY_FAMILY,
    product_type: 'perps',
    approval_intent: intent,
  });
  return intent;
}

function loadExecutableApprovedIntent(plan) {
  const intent = loadLiveApprovalIntent();
  if (!intent || intent.status !== 'approved' || intent.decision_id !== plan.decisionId) return null;
  if (intent.expires_at && new Date(intent.expires_at).getTime() <= Date.now()) {
    markApprovalIntentTerminal(intent, 'expired');
    return null;
  }
  return intent;
}

function buildLiveStubPlan(plan, approvalIntent) {
  const liveNotional = Math.min(Math.max(0.5, LIVE_STUB_NOTIONAL_USD), plan.paperNotional, MAX_PAPER_NOTIONAL_USD);
  const quantity = liveNotional / Math.max(plan.entryPrice, 1e-9);
  const feeUsd = liveNotional * (ESTIMATED_FEE_BPS / 10000);
  return {
    ...plan,
    paperNotional: liveNotional,
    quantity,
    feeUsd,
    metadata: {
      ...plan.metadata,
      live_stub: true,
      live_approval: {
        approval_id: approvalIntent?.approval_id || null,
        approved_at: approvalIntent?.approved_at || null,
      },
    },
  };
}

function consumeLiveCommand() {
  const state = loadLiveCommandState();
  const command = state?.command || null;
  if (!command || command.status !== 'pending') return null;
  return command;
}

function clearLiveCommand(command, status, patch = {}) {
  const next = {
    version: 1,
    command: command ? { ...command, ...patch, status, resolved_at: nowIso() } : null,
  };
  saveLiveCommandState(next);
  return next.command;
}

function findOpenPositionByRef(state, ref) {
  if (!ref) return null;
  return (state.open_positions || []).find(position => position.position_key === ref || position.decision_id === ref || normalizeSymbol(position.asset) === normalizeSymbol(ref)) || null;
}

function latestAccountSnapshot(state) {
  return state?.risk_summary?.latest_account_snapshot || null;
}

function extractCandidateExecutionEstimates(lane, market, planNotionalUsd = PAPER_NOTIONAL_USD) {
  const metadata = lane?.metadata || {};
  const execution = metadata.execution && typeof metadata.execution === 'object' ? metadata.execution : {};
  const marketRaw = market?.raw && typeof market.raw === 'object' ? market.raw : {};

  const bid = safeNumber(execution.best_bid_price ?? execution.bestBidPrice ?? marketRaw.best_bid_price ?? marketRaw.bestBidPrice, null);
  const ask = safeNumber(execution.best_ask_price ?? execution.bestAskPrice ?? marketRaw.best_ask_price ?? marketRaw.bestAskPrice, null);
  const mid = bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const explicitSpreadBps = safeNumber(
    execution.estimated_spread_bps
      ?? execution.estimatedSpreadBps
      ?? metadata.estimated_spread_bps
      ?? metadata.estimatedSpreadBps,
    null,
  );
  const spreadBps = explicitSpreadBps != null
    ? explicitSpreadBps
    : (mid != null && ask >= bid ? ((ask - bid) / mid) * 10000 : null);

  const explicitSlippageBps = safeNumber(
    execution.estimated_slippage_bps
      ?? execution.estimatedSlippageBps
      ?? metadata.estimated_slippage_bps
      ?? metadata.estimatedSlippageBps
      ?? lane?.quote_price_impact,
    null,
  );
  const volume24h = Math.max(
    safeNumber(market?.volume_usd_24h, 0) || 0,
    safeNumber(metadata.metrics?.volume24h, 0) || 0,
  );
  const high24h = safeNumber(market?.high_usd_24h, safeNumber(metadata.metrics?.highRecent, safeNumber(market?.price_usd, null)));
  const low24h = safeNumber(market?.low_usd_24h, safeNumber(market?.price_usd, high24h));
  const basePrice = Math.max(safeNumber(market?.price_usd, safeNumber(lane?.price, 0)) || 1, 1e-9);
  const rangePct = high24h != null && low24h != null && high24h >= low24h
    ? Math.max(0, (high24h - low24h) / basePrice)
    : 0;
  const proxySpreadBps = clamp((rangePct * 10000 * 0.04) + (volume24h < 25000000 ? 28 : volume24h < 50000000 ? 18 : volume24h < 100000000 ? 10 : 5), 4, 120);
  const effectiveSpreadBps = spreadBps != null ? spreadBps : proxySpreadBps;
  const volumeImpactBps = volume24h > 0 ? (planNotionalUsd / volume24h) * 10000 * 1440 : 999;
  const slippageBps = explicitSlippageBps != null
    ? explicitSlippageBps
    : clamp(Math.max(effectiveSpreadBps * 0.75, volumeImpactBps), 3, 180);

  return {
    spread_bps: Number(effectiveSpreadBps.toFixed(4)),
    slippage_bps: Number(slippageBps.toFixed(4)),
    has_explicit_spread: explicitSpreadBps != null || (mid != null && ask >= bid),
    has_explicit_slippage: explicitSlippageBps != null,
    market_volume_usd_24h: volume24h || null,
  };
}

function updateJournalEquityState(journal, state) {
  const equityState = ensureJournalShape(journal).state.equity;
  const baselineEquityUsd = safeNumber(equityState.baseline_equity_usd, PAPER_EQUITY_USD) || PAPER_EQUITY_USD;
  const accountEquityUsd = safeNumber(latestAccountSnapshot(state)?.equity_estimate_usd, null);
  const openUnrealizedUsd = (state.open_positions || []).reduce((sum, position) => sum + (safeNumber(position.unrealized_pnl_usd, 0) || 0), 0);
  const realizedUsd = safeNumber(state.daily_paper_metrics?.realized_pnl_usd, 0) || 0;
  const equityUsd = accountEquityUsd != null ? accountEquityUsd : baselineEquityUsd + realizedUsd + openUnrealizedUsd;
  const peakEquityUsd = Math.max(safeNumber(equityState.peak_equity_usd, equityUsd) || equityUsd, equityUsd);
  const currentDrawdownPct = peakEquityUsd > 0 ? ((peakEquityUsd - equityUsd) / peakEquityUsd) * 100 : 0;
  const maxDrawdownPct = Math.max(safeNumber(equityState.max_drawdown_pct, 0) || 0, currentDrawdownPct);
  journal.state.equity = {
    baseline_equity_usd: baselineEquityUsd,
    peak_equity_usd: Number(peakEquityUsd.toFixed(6)),
    last_equity_usd: Number(equityUsd.toFixed(6)),
    current_drawdown_pct: Number(currentDrawdownPct.toFixed(6)),
    max_drawdown_pct: Number(maxDrawdownPct.toFixed(6)),
    updated_ts: nowIso(),
  };
  saveJournal(journal);
  return journal.state.equity;
}

function evaluateEntryRiskGuards(state, journal, plan) {
  const equityState = updateJournalEquityState(journal, state);
  const openNotionalUsd = (state.open_positions || []).reduce((sum, position) => sum + (safeNumber(position.notional_usd, safeNumber(position.size_usd, 0)) || 0), 0);
  const postTradeOpenNotionalUsd = openNotionalUsd + (safeNumber(plan.paperNotional, 0) || 0);
  const effectiveEquityUsd = safeNumber(equityState.last_equity_usd, PAPER_EQUITY_USD) || PAPER_EQUITY_USD;
  const plannedLeverage = 1;
  const notionalToEquityPct = effectiveEquityUsd > 0 ? (postTradeOpenNotionalUsd / effectiveEquityUsd) * 100 : Infinity;
  const executionEstimates = extractCandidateExecutionEstimates(plan.lane, plan.metadata?.market_snapshot || {}, plan.paperNotional);

  if ((safeNumber(equityState.current_drawdown_pct, 0) || 0) >= MAX_ACCOUNT_DRAWDOWN_PCT) {
    return { blocked: true, blockReason: 'account_drawdown_cap_hit', guardContext: { equity: equityState } };
  }
  if (plannedLeverage > MAX_PLANNED_LEVERAGE) {
    return {
      blocked: true,
      blockReason: 'planned_leverage_too_high',
      guardContext: { planned_leverage: plannedLeverage, max_planned_leverage: MAX_PLANNED_LEVERAGE },
    };
  }
  if (postTradeOpenNotionalUsd > MAX_TOTAL_OPEN_NOTIONAL_USD) {
    return {
      blocked: true,
      blockReason: 'total_open_notional_cap_hit',
      guardContext: {
        open_notional_usd: openNotionalUsd,
        post_trade_open_notional_usd: postTradeOpenNotionalUsd,
        max_total_open_notional_usd: MAX_TOTAL_OPEN_NOTIONAL_USD,
      },
    };
  }
  if (notionalToEquityPct > MAX_NOTIONAL_TO_EQUITY_PCT) {
    return {
      blocked: true,
      blockReason: 'notional_to_equity_cap_hit',
      guardContext: {
        post_trade_open_notional_usd: Number(postTradeOpenNotionalUsd.toFixed(6)),
        equity_usd: Number(effectiveEquityUsd.toFixed(6)),
        notional_to_equity_pct: Number(notionalToEquityPct.toFixed(6)),
        max_notional_to_equity_pct: MAX_NOTIONAL_TO_EQUITY_PCT,
      },
    };
  }
  if ((safeNumber(executionEstimates.spread_bps, 0) || 0) > MAX_ESTIMATED_SPREAD_BPS) {
    return {
      blocked: true,
      blockReason: 'estimated_spread_too_wide',
      guardContext: { execution_estimates: executionEstimates, max_estimated_spread_bps: MAX_ESTIMATED_SPREAD_BPS },
    };
  }
  if ((safeNumber(executionEstimates.slippage_bps, 0) || 0) > MAX_ESTIMATED_SLIPPAGE_BPS) {
    return {
      blocked: true,
      blockReason: 'estimated_slippage_too_high',
      guardContext: { execution_estimates: executionEstimates, max_estimated_slippage_bps: MAX_ESTIMATED_SLIPPAGE_BPS },
    };
  }
  return {
    blocked: false,
    guardContext: {
      planned_leverage: plannedLeverage,
      post_trade_open_notional_usd: Number(postTradeOpenNotionalUsd.toFixed(6)),
      equity_usd: Number(effectiveEquityUsd.toFixed(6)),
      notional_to_equity_pct: Number(notionalToEquityPct.toFixed(6)),
      execution_estimates: executionEstimates,
      equity: equityState,
    },
  };
}

function log(message, extra = null) {
  const ts = new Date().toISOString();
  const rendered = extra ? `${message} ${JSON.stringify(extra)}` : message;
  const line = `[${ts}] ${rendered}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`);
}

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const ageMs = Date.now() - new Date(raw.ts).getTime();
      if (Number.isFinite(ageMs) && ageMs < 15 * 60 * 1000) {
        log('another perps-auto-trade run is active; skipping');
        return false;
      }
      fs.unlinkSync(LOCK_FILE);
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid }));
    return true;
  } catch (err) {
    log(`failed to manage lock: ${err.message}`);
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch (err) {
    log(`failed to release lock: ${err.message}`);
  }
}

function minutesSince(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  return ms / 60000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function quoteDriftBps(expectedPrice, actualPrice) {
  const expected = safeNumber(expectedPrice, null);
  const actual = safeNumber(actualPrice, null);
  if (expected == null || actual == null || expected <= 0 || actual <= 0) return null;
  return ((actual - expected) / expected) * 10000;
}

function orderMatchesAction(order, action) {
  return Boolean(
    order && action && (
      order.order_key === action.order_key
      || (order.raw && order.raw.action_key === action.action_key)
      || (action.submitted_order_ids || []).includes(order.order_key)
    )
  );
}

function fillIdentity(fill) {
  return fill?.raw?.fill_key || `${fill?.order_key || 'no-order'}:${fill?.ts || 'no-ts'}:${fill?.action || 'unknown'}`;
}

function fillMatchesAction(fill, action) {
  return Boolean(
    fill && action && (
      fill.position_key === action.position_key
      || (fill.raw && fill.raw.action_key === action.action_key)
      || (action.submitted_order_ids || []).includes(fill.order_key)
      || (action.fill_ids || []).includes(fillIdentity(fill))
    )
  );
}

function summarizePositionState(position) {
  if (!position) return null;
  return {
    position_key: position.position_key,
    status: position.status,
    asset: position.asset,
    side: position.side,
    entry_price_usd: safeNumber(position.entry_price_usd, null),
    mark_price_usd: safeNumber(position.mark_price_usd, null),
    notional_usd: safeNumber(position.notional_usd, null),
    size_usd: safeNumber(position.size_usd, null),
    realized_pnl_usd: safeNumber(position.realized_pnl_usd, null),
    unrealized_pnl_usd: safeNumber(position.unrealized_pnl_usd, null),
    updated_ts: position.updated_ts || position.opened_ts || null,
  };
}

function runDbCliWrite(command, payload) {
  const result = spawnSync('python', [EFFECTIVE_DB_CLI, command, '--db', EFFECTIVE_DB_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PATH: EFFECTIVE_PATH_ENV, PYTHONPATH: REPO_ROOT },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `DB CLI ${command} failed`);
  }
  return result.stdout?.trim() || '';
}

function runDbCliRead(command, args = []) {
  const result = spawnSync('python', [EFFECTIVE_DB_CLI, command, '--db', EFFECTIVE_DB_PATH, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PATH: EFFECTIVE_PATH_ENV, PYTHONPATH: REPO_ROOT },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `DB CLI ${command} failed`);
  }
  return JSON.parse(result.stdout || '{}');
}

function recordSystemEvent(eventType, severity, message, metadata = {}) {
  runDbCliWrite('record-event', {
    ts: new Date().toISOString(),
    event_type: eventType,
    severity,
    message,
    source: EXECUTOR_SOURCE,
    metadata,
  });
}

function recordRiskEvent(eventType, severity, message, metadata = {}) {
  runDbCliWrite('record-risk-event', {
    ts: new Date().toISOString(),
    product_type: 'perps',
    event_type: eventType,
    severity,
    scope: 'executor',
    scope_key: EXECUTOR_SOURCE,
    message,
    metadata,
  });
}

function readExecutorState() {
  return runDbCliRead('perp-executor-state', [
    '--minutes', String(CANDIDATE_LOOKBACK_MINUTES),
    '--analytics-lookback-hours', String(ANALYTICS_LOOKBACK_HOURS),
    '--recent-fill-limit', '50',
    '--recent-order-limit', '50',
  ]);
}

function readStrategyControls() {
  return runDbCliRead('strategy-controls', [
    '--min-trades', String(STRATEGY_POLICY_MIN_TRADES),
    '--min-realized-pnl-usd', String(STRATEGY_POLICY_MIN_REALIZED_PNL_USD),
  ]);
}

function compactPilotDecision(decision) {
  if (!decision || typeof decision !== 'object') return null;
  return {
    approved: Boolean(decision.approved),
    mode: decision.mode || null,
    product_type: decision.product_type || null,
    strategy: decision.strategy || null,
    symbol: decision.symbol || null,
    reason: decision.reason || null,
    blockers: Array.isArray(decision.blockers) ? decision.blockers : [],
  };
}

function normalizeSymbol(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function resolvePilotPolicyContext(strategyControls, candidateStrategy = null, candidateSymbol = null) {
  const pilotDecision = strategyControls?.tiny_live_pilot_decision;
  const compactDecision = compactPilotDecision(pilotDecision);
  const approvedSymbol = normalizeSymbol(compactDecision?.symbol);
  const requestedSymbol = normalizeSymbol(candidateSymbol);
  const context = {
    requested_mode: LIVE_REQUESTED ? 'live' : 'paper',
    env_live_allowed: LIVE_ALLOWED,
    env_live_enabled: LIVE_ENABLED,
    active_mode: MODE,
    strategy_family: STRATEGY_FAMILY,
    candidate_strategy: candidateStrategy || null,
    candidate_symbol: requestedSymbol || null,
    live_eligible_for_executor: false,
    policy_status: 'paper_only',
    denial_reason: null,
    tiny_live_pilot_decision: compactDecision,
  };

  if (!compactDecision) {
    context.denial_reason = 'missing_tiny_live_pilot_decision';
    return context;
  }
  if (!compactDecision.approved) {
    context.denial_reason = 'tiny_live_pilot_not_approved';
    return context;
  }
  if (compactDecision.product_type !== 'perps') {
    context.denial_reason = 'pilot_product_type_mismatch';
    return context;
  }
  if (!approvedSymbol) {
    context.denial_reason = 'pilot_symbol_missing';
    return context;
  }
  if (compactDecision.strategy === 'perp_no_trade') {
    context.denial_reason = 'pilot_strategy_not_actionable';
    return context;
  }
  if (!candidateStrategy) {
    context.policy_status = 'approved_but_no_live_candidate';
    return context;
  }
  if (!requestedSymbol) {
    context.denial_reason = 'candidate_symbol_missing';
    return context;
  }
  if (candidateStrategy === 'perp_no_trade') {
    context.denial_reason = 'candidate_strategy_not_actionable';
    return context;
  }
  if (compactDecision.strategy !== candidateStrategy) {
    context.denial_reason = 'pilot_strategy_mismatch';
    return context;
  }
  if (approvedSymbol !== requestedSymbol) {
    context.denial_reason = 'pilot_symbol_mismatch';
    return context;
  }

  context.live_eligible_for_executor = true;
  context.policy_status = 'approved_for_executor';
  return context;
}

function recordPilotPolicyOutcome(policyContext) {
  if (!LIVE_REQUESTED) return;

  const metadata = {
    requested_mode: policyContext.requested_mode,
    active_mode: policyContext.active_mode,
    env_live_allowed: policyContext.env_live_allowed,
    env_live_enabled: policyContext.env_live_enabled,
    strategy_family: policyContext.strategy_family,
    candidate_strategy: policyContext.candidate_strategy,
    candidate_symbol: policyContext.candidate_symbol,
    policy_status: policyContext.policy_status,
    denial_reason: policyContext.denial_reason,
    tiny_live_pilot_decision: policyContext.tiny_live_pilot_decision,
  };

  if (!LIVE_ALLOWED) {
    recordRiskEvent('perp_live_policy_denied', 'warning', 'Perp executor denied live mode because live execution is not enabled in the environment', metadata);
    recordSystemEvent('perp_live_policy_denied', 'warning', 'Perp executor denied live mode because live execution is not enabled in the environment', metadata);
    log('live mode request denied by environment gate; remaining paper-only', metadata);
    return;
  }

  if (policyContext.denial_reason) {
    recordRiskEvent('perp_live_policy_denied', 'warning', 'Perp executor denied live mode because tiny live pilot policy did not approve this executor cycle', metadata);
    recordSystemEvent('perp_live_policy_denied', 'warning', 'Perp executor denied live mode because tiny live pilot policy did not approve this executor cycle', metadata);
    log('live mode policy denied; remaining paper-only', metadata);
    return;
  }

  recordRiskEvent('perp_live_mode_stubbed', 'warning', 'Perp executor cycle matched tiny live pilot policy but execution remains paper-only by design', metadata);
  recordSystemEvent('perp_live_mode_stubbed', 'warning', 'Perp executor cycle matched tiny live pilot policy but execution remains paper-only by design', metadata);
  log('live mode policy approved but executor remains paper-stubbed', metadata);
}

function buildCompetitionMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const signalType = row?.signal_type;
    const horizon = row?.horizon_minutes;
    const competitionScope = row?.competition_scope === 'symbol' ? 'symbol' : 'basket';
    const symbol = normalizeSymbol(row?.symbol);
    if (competitionScope === 'symbol' && symbol) {
      map.set(`symbol:${symbol}:${signalType}:${horizon}`, row);
    }
    if (competitionScope === 'basket') {
      map.set(`basket:${signalType}:${horizon}`, row);
    }
  }
  return map;
}

function latestMarketMap(latestMarkets) {
  return new Map((latestMarkets || []).map(row => [normalizeSymbol(row.asset), row]));
}

function getFreshMarket(symbol, marketMap) {
  const market = marketMap.get(normalizeSymbol(symbol));
  if (!market?.ts) {
    return { ok: false, reason: 'missing_market_snapshot', market: market || null };
  }
  const ageMinutes = minutesSince(market.ts);
  if (!Number.isFinite(ageMinutes) || ageMinutes > MAX_MARKET_STALENESS_MINUTES) {
    return { ok: false, reason: 'stale_market_snapshot', market, age_minutes: ageMinutes };
  }
  return { ok: true, market, age_minutes: ageMinutes };
}

function recordExecutorDecision(decision, lane, status, reason, metadata = {}) {
  const candidateKey = `${decision.decision_id}:executor:${lane.signal_type}:${status}`;
  runDbCliWrite('record-perp-candidate', {
    ts: new Date().toISOString(),
    source: EXECUTOR_SOURCE,
    symbol: decision.symbol,
    market: decision.market || decision.symbol,
    signal_type: lane.signal_type,
    strategy_tag: lane.signal_type,
    side: lane.side,
    product_type: 'perps',
    price: lane.price ?? decision.price,
    reference_level: lane.reference_level,
    distance_pct: lane.distance_pct,
    liquidity: lane.liquidity,
    score: lane.score,
    regime_tag: lane.regime_tag || decision.regime_tag,
    decision_id: decision.decision_id,
    candidate_key: candidateKey,
    status,
    reason,
    metadata: {
      strategy_family: STRATEGY_FAMILY,
      executor_source: EXECUTOR_SOURCE,
      executor_status: status,
      ...metadata,
    },
  });
}

function latestFillTsFor(state, predicate) {
  for (const fill of state.recent_fills || []) {
    if (predicate(fill)) return fill.ts;
  }
  return null;
}

function latestOrderTsFor(state, predicate) {
  for (const order of state.recent_orders || []) {
    if (predicate(order)) return order.ts;
  }
  return null;
}

function findNoTradeLane(decision) {
  return (decision.lanes || []).find(lane => lane.signal_type === 'perp_no_trade') || null;
}

function findLatestActionForPosition(journal, positionKey) {
  return Object.values(journal.actions || {})
    .filter(action => action.position_key === positionKey)
    .sort((a, b) => String(b.updated_ts || '').localeCompare(String(a.updated_ts || '')))[0] || null;
}

function reconcileJournalWithState(state, journal) {
  const openPositions = state.open_positions || [];
  const recentOrders = state.recent_orders || [];
  const recentFills = state.recent_fills || [];
  const summary = {
    recovered_orphan_positions: 0,
    recovered_timeout_actions: 0,
    active_actions: [],
  };

  for (const position of openPositions) {
    const existingAction = findLatestActionForPosition(journal, position.position_key);
    if (existingAction) continue;
    const actionKey = `recovered:${position.position_key}`;
    upsertJournalAction(journal, actionKey, {
      action_type: 'recovered_position',
      status: 'open_position_active',
      symbol: position.asset,
      decision_id: position.decision_id || null,
      position_key: position.position_key,
      current_position_state: summarizePositionState(position),
      last_risk_decision: 'orphaned_open_position_recovered',
      recovery_notes: ['orphaned_open_position_recovered'],
      terminal: false,
    });
    recordRiskEvent('perp_orphan_position_recovered', 'warning', `Recovered orphaned open perp position for ${position.asset}`, {
      strategy_family: STRATEGY_FAMILY,
      position_key: position.position_key,
      symbol: position.asset,
      decision_id: position.decision_id,
    });
    summary.recovered_orphan_positions += 1;
  }

  for (const action of Object.values(journal.actions || {})) {
    let matchingOrders = recentOrders.filter(order => orderMatchesAction(order, action));
    let matchingFills = recentFills.filter(fill => fillMatchesAction(fill, action));
    let matchingPosition = openPositions.find(position => position.position_key === action.position_key) || null;

    if (action.action_type === 'open_short' && action.status === 'partial_fill_pending' && matchingPosition && action.plan_snapshot) {
      const filledNotionalUsd = safeNumber(matchingPosition.notional_usd, safeNumber(matchingPosition.size_usd, 0)) || 0;
      const requestedNotionalUsd = safeNumber(action.intended_action?.requested_notional_usd, safeNumber(action.plan_snapshot.paperNotional, 0)) || 0;
      const remainingNotionalUsd = Math.max(0, requestedNotionalUsd - filledNotionalUsd);
      const marketState = getFreshMarket(action.symbol, latestMarketMap(state.latest_markets));
      if (remainingNotionalUsd > 1e-9) {
        if (!marketState.ok) {
          const cancelOrderKey = `${action.action_key}:cancel:${matchingOrders.length}`;
          runDbCliWrite('record-perp-order', {
            ts: nowIso(),
            order_key: cancelOrderKey,
            position_key: action.position_key,
            asset: action.symbol,
            side: 'sell',
            order_type: 'cancel',
            status: 'cancelled',
            size_usd: remainingNotionalUsd,
            limit_price: action.intended_action?.requested_price,
            mode: 'paper',
            strategy_tag: `tiny_live_pilot_${action.plan_snapshot.signalType}`,
            decision_id: action.decision_id,
            reason: `Cancelled remaining entry after partial fill because ${marketState.reason}`,
            signature: cancelOrderKey,
            raw: { action_key: action.action_key, cancel_reason: marketState.reason, strategy_family: STRATEGY_FAMILY },
          });
          recordRiskEvent('perp_partial_fill_cancelled_remainder', 'warning', `Cancelled remaining partial-fill entry for ${action.symbol}`, {
            strategy_family: STRATEGY_FAMILY,
            action_key: action.action_key,
            decision_id: action.decision_id,
            symbol: action.symbol,
            remaining_notional_usd: remainingNotionalUsd,
            reason: marketState.reason,
          });
          action.last_risk_decision = marketState.reason;
        } else {
          const replacementIndex = (action.replacement_count || 0) + 1;
          const replacementOrderKey = `${action.action_key}:replace:${replacementIndex}`;
          runDbCliWrite('record-perp-order', {
            ts: nowIso(),
            order_key: `${action.action_key}:cancel:${replacementIndex}`,
            position_key: action.position_key,
            asset: action.symbol,
            side: 'sell',
            order_type: 'cancel_replace',
            status: 'cancelled',
            size_usd: remainingNotionalUsd,
            limit_price: action.intended_action?.requested_price,
            mode: 'paper',
            strategy_tag: `tiny_live_pilot_${action.plan_snapshot.signalType}`,
            decision_id: action.decision_id,
            reason: 'Cancelled remainder before replacement after partial fill',
            signature: `${action.action_key}:cancel:${replacementIndex}`,
            raw: { action_key: action.action_key, strategy_family: STRATEGY_FAMILY, replace_order_key: replacementOrderKey },
          });
          recordPaperEntryFill(action.plan_snapshot, action, replacementOrderKey, remainingNotionalUsd, safeNumber(marketState.market?.price_usd, action.plan_snapshot.entryPrice), 'filled', 1, replacementIndex);
          recordSystemEvent('perp_executor_recovery', 'info', `Completed cancel/replace for partial paper short on ${action.symbol}`, {
            strategy_family: STRATEGY_FAMILY,
            action_key: action.action_key,
            decision_id: action.decision_id,
            symbol: action.symbol,
            remaining_notional_usd: remainingNotionalUsd,
            replacement_order_key: replacementOrderKey,
          });
          action.replacement_count = replacementIndex;
          action.last_risk_decision = 'partial_fill_cancel_replace_completed';
        }
        matchingOrders = readExecutorState().recent_orders || recentOrders;
        matchingFills = readExecutorState().recent_fills || recentFills;
        matchingPosition = readExecutorState().open_positions.find(position => position.position_key === action.position_key) || matchingPosition;
      }
    }

    const nextStatus = matchingPosition
      ? 'open_position_active'
      : matchingFills.length > 0
        ? (action.status === 'partial_fill_pending' ? 'partial_fill_pending' : 'filled')
        : matchingOrders.some(order => String(order.status || '').includes('cancel'))
          ? 'cancelled'
          : matchingOrders.length > 0
            ? 'submitted'
            : action.status;
    const recoveredTimeout = action.status === 'timeout_pending_verification' && (matchingFills.length > 0 || matchingPosition);
    const nextAction = upsertJournalAction(journal, action.action_key, {
      status: nextStatus,
      submitted_order_ids: matchingOrders.map(order => order.order_key),
      fill_ids: matchingFills.map(fill => fillIdentity(fill)),
      current_position_state: summarizePositionState(matchingPosition),
      last_risk_decision: action.last_risk_decision,
      replacement_count: action.replacement_count,
      last_verification: {
        verified_ts: nowIso(),
        order_count: matchingOrders.length,
        fill_count: matchingFills.length,
        has_open_position: Boolean(matchingPosition),
      },
      recovery_notes: recoveredTimeout ? ['timeout_recovered_via_reconciliation'] : [],
      terminal: nextStatus === 'cancelled' || nextStatus === 'filled' || (nextStatus === 'open_position_active' && action.action_type === 'close_short'),
    });
    if (recoveredTimeout) {
      nextAction.last_risk_decision = 'timeout_recovered_via_reconciliation';
      journal.actions[action.action_key] = nextAction;
      saveJournal(journal);
      summary.recovered_timeout_actions += 1;
    }
    if (!actionIsTerminal(nextAction)) {
      summary.active_actions.push(summarizeJournalAction(nextAction));
    }
  }

  return summary;
}

function buildEntryPlan(decision, state) {
  const lane = decision.best_short_lane;
  if (!lane || lane.status !== 'candidate') return { blocked: true, blockReason: 'no_candidate_short_lane' };

  const normalizedSymbol = String(decision.symbol || '').trim().toUpperCase();
  if (!normalizedSymbol || !EXECUTOR_ALLOWLIST.has(normalizedSymbol)) {
    return {
      blocked: true,
      blockReason: 'symbol_not_allowlisted',
      symbol: decision.symbol,
      allowlist: Array.from(EXECUTOR_ALLOWLIST),
      lane,
    };
  }
  const marketMap = latestMarketMap(state.latest_markets);
  const marketState = getFreshMarket(decision.symbol, marketMap);
  if (!marketState.ok) {
    return { blocked: true, blockReason: marketState.reason, marketState, lane };
  }
  const market = marketState.market || {};
  const decisionAgeMinutes = minutesSince(decision.ts);
  if (!Number.isFinite(decisionAgeMinutes) || decisionAgeMinutes > MAX_SIGNAL_AGE_MINUTES) {
    return { blocked: true, blockReason: 'stale_signal' };
  }
  if (safeNumber(lane.score, 0) < ENTRY_SCORE_THRESHOLD) {
    return { blocked: true, blockReason: 'score_below_threshold' };
  }

  const noTradeLane = findNoTradeLane(decision);
  const noTradeScore = safeNumber(noTradeLane?.score, 0);
  const competition = buildCompetitionMap(state.competition);
  const decisionSymbol = normalizeSymbol(decision.symbol || lane.symbol || decision.market);
  const lane60 = (decisionSymbol
    ? competition.get(`symbol:${decisionSymbol}:${lane.signal_type}:60`)
    : null) || competition.get(`basket:${lane.signal_type}:60`);
  const analyticsBonus = lane60
    ? clamp((safeNumber(lane60.win_rate, 0.5) - 0.5) * 40 + safeNumber(lane60.avg_edge_pct, 0) * 4, -8, 12)
    : 0;
  const compositeScore = safeNumber(lane.score, 0) + analyticsBonus - clamp((noTradeScore - 50) / 5, 0, 8);
  const price = safeNumber(market.price_usd, safeNumber(lane.price, safeNumber(decision.price)));
  if (!price || price <= 0) return { blocked: true, blockReason: 'invalid_price' };

  const metadata = lane.metadata || {};
  const referenceLevel = safeNumber(lane.reference_level, safeNumber(metadata.metrics?.highRecent, price));
  const change24h = safeNumber(market.change_pct_24h, safeNumber(metadata.metrics?.change24h, 0));
  const volume24h = safeNumber(market.volume_usd_24h, safeNumber(metadata.metrics?.volume24h, 0));
  const stopPct = lane.signal_type === 'perp_short_failed_bounce' ? BASE_STOP_PCT + 0.2 : BASE_STOP_PCT;
  const targetPct = lane.signal_type === 'perp_short_failed_bounce' ? BASE_TARGET_PCT + 0.4 : BASE_TARGET_PCT;
  const invalidationPrice = Math.max(
    price * (1 + (stopPct / 100)),
    referenceLevel * (1 + (INVALIDATION_BUFFER_PCT / 100)),
  );
  const stopLossPrice = invalidationPrice;
  const takeProfitPrice = price * (1 - (targetPct / 100));
  const paperNotional = Math.min(PAPER_NOTIONAL_USD, MAX_PAPER_NOTIONAL_USD);
  const quantity = paperNotional / price;
  const feeUsd = paperNotional * (ESTIMATED_FEE_BPS / 10000);
  const executionEstimates = extractCandidateExecutionEstimates(lane, market, paperNotional);

  return {
    blocked: false,
    decisionId: decision.decision_id,
    symbol: decision.symbol,
    signalType: lane.signal_type,
    entryPrice: price,
    paperNotional,
    quantity,
    stopLossPrice,
    takeProfitPrice,
    invalidationPrice,
    feeUsd,
    compositeScore,
    decisionAgeMinutes,
    regimeTag: decision.regime_tag || lane.regime_tag,
    change24h,
    volume24h,
    reason: lane.reason,
    lane,
    noTradeScore,
    marketAgeMinutes: marketState.age_minutes,
    metadata: {
      strategy_family: STRATEGY_FAMILY,
      market_snapshot: market,
      candidate_metrics: metadata.metrics || null,
      candidate_score_components: metadata.score_components || null,
      execution_estimates: executionEstimates,
      invalidation: {
        price: invalidationPrice,
        kind: 'hard_price_stop_for_short',
        derived_from_reference_level: referenceLevel,
        buffer_pct: INVALIDATION_BUFFER_PCT,
      },
      stop: {
        stop_loss_price: stopLossPrice,
        stop_loss_pct: stopPct,
        take_profit_price: takeProfitPrice,
        take_profit_pct: targetPct,
        max_hold_minutes: MAX_HOLD_MINUTES,
      },
      quantity,
      estimated_open_fee_usd: feeUsd,
      estimated_close_fee_usd: feeUsd,
      analytics_60m: lane60 || null,
      composite_score: compositeScore,
      no_trade_score: noTradeScore,
      market_age_minutes: marketState.age_minutes,
    },
  };
}

function buildSyntheticNoTradeLane(decision, plan, reason) {
  const sourceLane = plan?.lane || decision.best_short_lane || {};
  return {
    ts: decision.ts,
    source: EXECUTOR_SOURCE,
    symbol: decision.symbol,
    market: decision.market || decision.symbol,
    signal_type: 'perp_no_trade',
    strategy_tag: 'perp_no_trade',
    side: 'flat',
    price: sourceLane.price ?? decision.price,
    reference_level: sourceLane.reference_level,
    distance_pct: sourceLane.distance_pct,
    liquidity: sourceLane.liquidity,
    score: 100,
    regime_tag: sourceLane.regime_tag || decision.regime_tag,
    status: 'candidate',
    reason,
    metadata: {
      synthetic: true,
      strategy_family: STRATEGY_FAMILY,
      blocked_candidate_strategy: sourceLane.signal_type || null,
      blocked_trade_reason: reason,
      allowlist: Array.from(EXECUTOR_ALLOWLIST),
    },
  };
}

function buildDecisionChoice(decision, state) {
  const plan = buildEntryPlan(decision, state);
  const blockedTrade = plan?.blocked;
  const noTradeLane = findNoTradeLane(decision);
  const effectiveNoTradeLane = noTradeLane || (blockedTrade ? buildSyntheticNoTradeLane(decision, plan, plan.blockReason) : null);
  const noTradeScore = safeNumber(effectiveNoTradeLane?.score, 0);
  const shortScore = blockedTrade ? safeNumber(decision.best_short_lane?.score, 0) : safeNumber(plan?.compositeScore, 0);
  const chooseNoTrade = Boolean(effectiveNoTradeLane) && (blockedTrade || noTradeScore >= shortScore);
  if (chooseNoTrade) {
    return {
      type: 'no_trade',
      decision,
      lane: effectiveNoTradeLane,
      reason: blockedTrade ? `paper_no_trade_due_to_${plan.blockReason}` : 'paper_no_trade_lane_selected',
      plan,
    };
  }
  if (blockedTrade) {
    return null;
  }
  return {
    type: 'trade',
    decision,
    lane: plan.lane,
    plan,
  };
}

function choicePriority(choice) {
  if (!choice) return -1;
  if (choice.type === 'trade') return 2;
  if (choice.type === 'no_trade' && choice.plan?.blocked) return 1;
  return 0;
}

function pickEntryDecision(state) {
  const seenSymbols = new Set();
  const choices = [];
  for (const decision of state.decisions || []) {
    const dedupeSymbol = normalizeSymbol(decision.symbol);
    if (seenSymbols.has(dedupeSymbol)) continue;
    seenSymbols.add(dedupeSymbol);
    const choice = buildDecisionChoice(decision, state);
    if (choice) choices.push(choice);
  }
  choices.sort((a, b) => {
    const priorityGap = choicePriority(b) - choicePriority(a);
    if (priorityGap) return priorityGap;
    const aScore = a.type === 'trade' ? a.plan.compositeScore : safeNumber(a.lane?.score, 0);
    const bScore = b.type === 'trade' ? b.plan.compositeScore : safeNumber(b.lane?.score, 0);
    return bScore - aScore || minutesSince(a.decision.ts) - minutesSince(b.decision.ts);
  });
  return choices[0] || null;
}

function currentPriceForPosition(position, marketMap) {
  const marketState = getFreshMarket(position.asset, marketMap);
  if (!marketState.ok) return { ok: false, reason: marketState.reason, marketState };
  const price = safeNumber(marketState.market?.price_usd, safeNumber(position.mark_price_usd, safeNumber(position.entry_price_usd)));
  if (!price || price <= 0) return { ok: false, reason: 'invalid_market_price', marketState };
  return { ok: true, price, marketState };
}

function pnlForShort(entryPrice, currentPrice, notionalUsd) {
  if (!entryPrice || !currentPrice || !notionalUsd) return 0;
  return ((entryPrice - currentPrice) / entryPrice) * notionalUsd;
}

function updatePaperPositionMark(position, currentPrice, unrealizedPnlUsd, exitState = null) {
  const raw = { ...(position.raw || {}) };
  if (exitState) raw.exit = exitState;
  runDbCliWrite('record-perp-position', {
    position_key: position.position_key,
    opened_ts: position.opened_ts,
    updated_ts: new Date().toISOString(),
    closed_ts: exitState?.closed_ts || null,
    status: exitState ? 'closed' : 'open',
    asset: position.asset,
    side: position.side,
    collateral_token: position.collateral_token || 'USDC',
    entry_price_usd: position.entry_price_usd,
    mark_price_usd: currentPrice,
    liq_price_usd: position.liq_price_usd,
    size_usd: position.size_usd,
    notional_usd: position.notional_usd,
    margin_used_usd: position.margin_used_usd,
    leverage: position.leverage,
    take_profit_price: position.take_profit_price,
    stop_loss_price: position.stop_loss_price,
    unrealized_pnl_usd: exitState ? 0 : unrealizedPnlUsd,
    realized_pnl_usd: exitState?.realized_pnl_usd ?? position.realized_pnl_usd,
    fees_usd: exitState?.fees_usd ?? position.fees_usd,
    funding_usd: position.funding_usd || 0,
    strategy_tag: position.strategy_tag,
    mode: 'paper',
    decision_id: position.decision_id,
    source: EXECUTOR_SOURCE,
    raw,
  });
}

function recordPaperEntryFill(plan, action, orderKey, fillNotionalUsd, fillPrice, fillStatus, fillFraction, replacementIndex = 0) {
  const ts = nowIso();
  const strategyTag = `tiny_live_pilot_${plan.signalType}`;
  const quantity = fillNotionalUsd / Math.max(fillPrice, 1e-9);
  const feeUsd = fillNotionalUsd * (ESTIMATED_FEE_BPS / 10000);
  const fillKey = `${action.action_key}:fill:${replacementIndex}:${fillStatus}`;
  const raw = {
    action_key: action.action_key,
    strategy_family: STRATEGY_FAMILY,
    quantity,
    fill_fraction: fillFraction,
    replacement_index: replacementIndex,
    thesis: {
      signal_type: plan.signalType,
      regime_tag: plan.regimeTag,
      reason: plan.reason,
      composite_score: plan.compositeScore,
    },
    risk: plan.metadata,
  };

  runDbCliWrite('record-perp-order', {
    ts,
    order_key: orderKey,
    position_key: action.position_key,
    asset: plan.symbol,
    side: 'sell',
    order_type: 'market',
    status: fillStatus,
    size_usd: fillNotionalUsd,
    limit_price: plan.entryPrice,
    slippage_bps: quoteDriftBps(plan.entryPrice, fillPrice),
    mode: 'paper',
    strategy_tag: strategyTag,
    decision_id: plan.decisionId,
    reason: `Paper short entry for ${plan.signalType}`,
    signature: orderKey,
    raw,
  });

  runDbCliWrite('record-perp-fill', {
    ts,
    fill_key: fillKey,
    position_key: action.position_key,
    order_key: orderKey,
    asset: plan.symbol,
    side: 'sell',
    action: 'open',
    price_usd: fillPrice,
    size_usd: fillNotionalUsd,
    fees_usd: feeUsd,
    funding_usd: 0,
    realized_pnl_usd: 0,
    mode: 'paper',
    strategy_tag: strategyTag,
    decision_id: plan.decisionId,
    raw: { ...raw, fill_key: fillKey },
  });

  const existingPosition = action.current_position_state || null;
  const previousNotional = safeNumber(existingPosition?.notional_usd, 0) || 0;
  const nextNotional = previousNotional + fillNotionalUsd;
  const weightedEntryPrice = nextNotional > 0
    ? (((safeNumber(existingPosition?.entry_price_usd, fillPrice) || fillPrice) * previousNotional) + (fillPrice * fillNotionalUsd)) / nextNotional
    : fillPrice;
  const cumulativeFeesUsd = (safeNumber(existingPosition?.fees_usd, 0) || 0) + feeUsd;

  const positionRaw = {
    action_key: action.action_key,
    strategy_family: STRATEGY_FAMILY,
    quantity: (safeNumber(existingPosition?.size_usd, 0) || 0) / Math.max(safeNumber(existingPosition?.entry_price_usd, fillPrice) || fillPrice, 1e-9) + quantity,
    thesis: raw.thesis,
    risk: plan.metadata,
    fills: mergeUnique(existingPosition?.fill_ids, [fillKey]),
  };

  runDbCliWrite('record-perp-position', {
    position_key: action.position_key,
    opened_ts: action.created_ts || ts,
    updated_ts: ts,
    status: 'open',
    asset: plan.symbol,
    side: 'sell',
    collateral_token: 'USDC',
    entry_price_usd: weightedEntryPrice,
    mark_price_usd: fillPrice,
    liq_price_usd: plan.invalidationPrice * 2,
    size_usd: nextNotional,
    notional_usd: nextNotional,
    margin_used_usd: nextNotional,
    leverage: 1,
    take_profit_price: plan.takeProfitPrice,
    stop_loss_price: plan.stopLossPrice,
    unrealized_pnl_usd: -cumulativeFeesUsd,
    realized_pnl_usd: 0,
    fees_usd: cumulativeFeesUsd,
    funding_usd: 0,
    strategy_tag: strategyTag,
    mode: 'paper',
    decision_id: plan.decisionId,
    source: EXECUTOR_SOURCE,
    raw: positionRaw,
  });

  runDbCliWrite('record-trade', {
    ts,
    symbol: plan.symbol,
    side: 'sell',
    mode: 'paper',
    simulated: true,
    product_type: 'perps',
    venue: 'paper_engine',
    strategy_family: STRATEGY_FAMILY,
    decision_id: plan.decisionId,
    market: plan.symbol,
    price: fillPrice,
    amount: quantity,
    size_usd: fillNotionalUsd,
    out_amount: String(fillNotionalUsd),
    expected_out_amount: String(Math.max(0, fillNotionalUsd - feeUsd)),
    signature: orderKey,
    quote_price_impact: 0,
    reason: `Paper perp short entry: ${plan.signalType}`,
    strategy_tag: strategyTag,
    cost_basis_usd: fillNotionalUsd,
    validation_mode: plan.metadata?.live_stub ? 'tiny_live_stub' : 'paper',
    approval_status: plan.metadata?.live_stub ? 'telegram_approved' : 'paper_only',
  });

  return {
    ts,
    orderKey,
    fillKey,
    feeUsd,
    fillPrice,
    fillNotionalUsd,
    quantity,
    nextNotional,
  };
}

function openPaperShort(plan, state, journal) {
  const actionKey = `open:${plan.decisionId}`;
  const existingAction = journal.actions?.[actionKey];
  if (existingAction && !actionIsTerminal(existingAction)) {
    return {
      action: existingAction.status === 'partial_fill_pending' ? 'partial_fill' : 'opened',
      reason: 'reused_existing_intent',
      symbol: plan.symbol,
      signal_type: plan.signalType,
      decision_id: plan.decisionId,
      action_state: summarizeJournalAction(existingAction),
    };
  }

  const requestedMarket = getFreshMarket(plan.symbol, latestMarketMap(state.latest_markets));
  if (!requestedMarket.ok) {
    const rejectedAction = upsertJournalAction(journal, actionKey, {
      action_type: 'open_short',
      status: 'rejected_stale_quote',
      symbol: plan.symbol,
      decision_id: plan.decisionId,
      position_key: `paper-perp:${plan.decisionId}`,
      intended_action: {
        side: 'sell',
        signal_type: plan.signalType,
        requested_notional_usd: plan.paperNotional,
        requested_price: plan.entryPrice,
      },
      last_risk_decision: requestedMarket.reason,
      terminal: true,
    });
    recordRiskEvent('perp_entry_stale_quote_rejected', 'warning', `Rejected paper short on ${plan.symbol} due to stale quote`, {
      strategy_family: STRATEGY_FAMILY,
      decision_id: plan.decisionId,
      symbol: plan.symbol,
      market_state: requestedMarket,
      action_key: actionKey,
    });
    return {
      action: 'skip',
      reason: requestedMarket.reason,
      symbol: plan.symbol,
      signal_type: plan.signalType,
      decision_id: plan.decisionId,
      action_state: summarizeJournalAction(rejectedAction),
    };
  }

  const fillFraction = clamp(SIMULATED_PARTIAL_FILL_PCT / 100, 0.01, 1);
  const responseDriftMultiplier = 1 + (SIMULATED_RESPONSE_DRIFT_BPS / 10000);
  const actualFillPrice = plan.entryPrice * responseDriftMultiplier;
  const driftBps = quoteDriftBps(plan.entryPrice, actualFillPrice);
  const positionKey = `paper-perp:${plan.decisionId}`;
  const orderKey = `${actionKey}:order:1`;
  const action = upsertJournalAction(journal, actionKey, {
    action_type: 'open_short',
    status: 'submitted',
    symbol: plan.symbol,
    decision_id: plan.decisionId,
    position_key: positionKey,
    order_key: orderKey,
    intended_action: {
      side: 'sell',
      signal_type: plan.signalType,
      requested_notional_usd: plan.paperNotional,
      requested_price: plan.entryPrice,
      requested_quantity: plan.quantity,
      requested_mode: MODE,
    },
    plan_snapshot: {
      symbol: plan.symbol,
      signalType: plan.signalType,
      decisionId: plan.decisionId,
      entryPrice: plan.entryPrice,
      paperNotional: plan.paperNotional,
      quantity: plan.quantity,
      stopLossPrice: plan.stopLossPrice,
      takeProfitPrice: plan.takeProfitPrice,
      invalidationPrice: plan.invalidationPrice,
      compositeScore: plan.compositeScore,
      regimeTag: plan.regimeTag,
      reason: plan.reason,
      metadata: plan.metadata,
    },
    submitted_order_ids: [orderKey],
    last_risk_decision: 'submitted',
    terminal: false,
  });

  const fillNotionalUsd = Number((plan.paperNotional * fillFraction).toFixed(8));
  const fillStatus = fillFraction < 0.999999 ? 'partially_filled' : 'filled';
  const fillResult = recordPaperEntryFill(plan, action, orderKey, fillNotionalUsd, actualFillPrice, fillStatus, fillFraction, 0);
  const recoveryNotes = [];
  let status = fillFraction < 0.999999 ? 'partial_fill_pending' : 'filled';
  let lastRiskDecision = fillFraction < 0.999999 ? 'partial_fill_pending_replace' : 'verified_filled';

  if (driftBps != null && Math.abs(driftBps) > MAX_QUOTE_DRIFT_BPS) {
    recoveryNotes.push('response_drift_detected');
    lastRiskDecision = 'response_drift_detected';
    recordRiskEvent('perp_execution_response_drift', 'warning', `Perp entry response drift detected for ${plan.symbol}`, {
      strategy_family: STRATEGY_FAMILY,
      decision_id: plan.decisionId,
      symbol: plan.symbol,
      action_key: actionKey,
      expected_price: plan.entryPrice,
      actual_price: actualFillPrice,
      drift_bps: driftBps,
      max_quote_drift_bps: MAX_QUOTE_DRIFT_BPS,
    });
  }

  if (SIMULATED_SUBMIT_TIMEOUT_MODE === 'filled') {
    status = 'timeout_pending_verification';
    recoveryNotes.push('submit_timeout_after_possible_fill');
    lastRiskDecision = 'submit_timeout_after_possible_fill';
    recordRiskEvent('perp_submit_timeout_ambiguous', 'warning', `Perp entry submit timed out after possible fill for ${plan.symbol}`, {
      strategy_family: STRATEGY_FAMILY,
      decision_id: plan.decisionId,
      symbol: plan.symbol,
      action_key: actionKey,
      order_key: orderKey,
    });
  }

  const nextAction = upsertJournalAction(journal, actionKey, {
    status,
    submitted_order_ids: [orderKey],
    fill_ids: [fillResult.fillKey],
    current_position_state: {
      position_key: positionKey,
      status: 'open',
      asset: plan.symbol,
      side: 'sell',
      entry_price_usd: actualFillPrice,
      mark_price_usd: actualFillPrice,
      notional_usd: fillResult.nextNotional,
      size_usd: fillResult.nextNotional,
      realized_pnl_usd: 0,
      unrealized_pnl_usd: -fillResult.feeUsd,
      updated_ts: fillResult.ts,
      fees_usd: fillResult.feeUsd,
    },
    last_risk_decision: lastRiskDecision,
    recovery_notes: recoveryNotes,
    terminal: status === 'filled',
  });

  recordSystemEvent('perp_executor_decision', 'info', `Opened paper short on ${plan.symbol}`, {
    mode: MODE,
    strategy_family: STRATEGY_FAMILY,
    product_type: 'perps',
    decision_id: plan.decisionId,
    symbol: plan.symbol,
    signal_type: plan.signalType,
    entry_price: actualFillPrice,
    requested_entry_price: plan.entryPrice,
    size_usd: fillNotionalUsd,
    invalidation_price: plan.invalidationPrice,
    stop_loss_price: plan.stopLossPrice,
    take_profit_price: plan.takeProfitPrice,
    composite_score: plan.compositeScore,
    action_key: actionKey,
    fill_status: fillStatus,
    drift_bps: driftBps,
  });

  return {
    action: fillFraction < 0.999999 ? 'partial_fill' : 'opened',
    reason: status === 'timeout_pending_verification' ? 'submit_timeout_after_possible_fill' : fillStatus,
    symbol: plan.symbol,
    signal_type: plan.signalType,
    decision_id: plan.decisionId,
    entry_price: actualFillPrice,
    size_usd: fillNotionalUsd,
    stop_loss_price: plan.stopLossPrice,
    take_profit_price: plan.takeProfitPrice,
    action_state: summarizeJournalAction(nextAction),
  };
}

function closePaperShort(position, currentPrice, exitReason, options = {}) {
  const ts = new Date().toISOString();
  const raw = position.raw || {};
  const reductionFraction = clamp(safeNumber(options.reduction_fraction, 1) || 1, 0.05, 1);
  const quantity = safeNumber(raw.quantity, safeNumber(position.notional_usd) / Math.max(safeNumber(position.entry_price_usd, 1), 1e-9)) || 0;
  const closingQuantity = quantity * reductionFraction;
  const exitNotional = closingQuantity * currentPrice;
  const entryNotional = safeNumber(position.notional_usd, 0);
  const closingEntryNotional = entryNotional * reductionFraction;
  const grossPnl = pnlForShort(position.entry_price_usd, currentPrice, closingEntryNotional);
  const existingRealizedPnlUsd = safeNumber(position.realized_pnl_usd, 0) || 0;
  const existingFeesUsd = safeNumber(position.fees_usd, 0) || 0;
  const openFeeUsd = (safeNumber(raw.risk?.estimated_open_fee_usd, existingFeesUsd) || 0) * reductionFraction;
  const closeFeeUsd = exitNotional * (ESTIMATED_FEE_BPS / 10000);
  const realizedPnlUsd = grossPnl - openFeeUsd - closeFeeUsd;
  const totalFeesUsd = openFeeUsd + closeFeeUsd;
  const closeKind = reductionFraction < 0.999999 ? 'reduce' : 'close';
  const orderKey = `paper-${closeKind}:${position.decision_id}:${ts}`;

  runDbCliWrite('record-perp-order', {
    ts,
    order_key: orderKey,
    position_key: position.position_key,
    asset: position.asset,
    side: 'buy',
    order_type: 'market',
    status: 'filled',
    size_usd: exitNotional,
    limit_price: currentPrice,
    slippage_bps: 0,
    mode: 'paper',
    strategy_tag: position.strategy_tag,
    decision_id: position.decision_id,
    reason: `Paper short ${closeKind}: ${exitReason}`,
    signature: orderKey,
    raw: { strategy_family: STRATEGY_FAMILY, exit_reason: exitReason, reduction_fraction: reductionFraction },
  });

  runDbCliWrite('record-perp-fill', {
    ts,
    fill_key: `${orderKey}:fill`,
    position_key: position.position_key,
    order_key: orderKey,
    asset: position.asset,
    side: 'buy',
    action: reductionFraction < 0.999999 ? 'reduce' : 'close',
    price_usd: currentPrice,
    size_usd: exitNotional,
    fees_usd: closeFeeUsd,
    funding_usd: 0,
    realized_pnl_usd: realizedPnlUsd,
    mode: 'paper',
    strategy_tag: position.strategy_tag,
    decision_id: position.decision_id,
    raw: { strategy_family: STRATEGY_FAMILY, exit_reason: exitReason, gross_pnl_usd: grossPnl, reduction_fraction: reductionFraction },
  });

  const remainingFraction = Math.max(0, 1 - reductionFraction);
  const nextQuantity = quantity * remainingFraction;
  const nextEntryNotional = entryNotional * remainingFraction;
  const nextFeesUsd = existingFeesUsd + closeFeeUsd;
  const nextRealizedPnlUsd = existingRealizedPnlUsd + realizedPnlUsd;

  if (remainingFraction <= 1e-9) {
    updatePaperPositionMark(position, currentPrice, 0, {
      closed_ts: ts,
      realized_pnl_usd: nextRealizedPnlUsd,
      fees_usd: nextFeesUsd,
      reason: exitReason,
      reduction_fraction: reductionFraction,
    });
  } else {
    const nextRaw = { ...(position.raw || {}) };
    nextRaw.quantity = nextQuantity;
    nextRaw.last_reduce = { ts, exit_reason: exitReason, reduction_fraction: reductionFraction, realized_pnl_usd: realizedPnlUsd };
    runDbCliWrite('record-perp-position', {
      position_key: position.position_key,
      opened_ts: position.opened_ts,
      updated_ts: ts,
      closed_ts: null,
      status: 'open',
      asset: position.asset,
      side: position.side,
      collateral_token: position.collateral_token || 'USDC',
      entry_price_usd: position.entry_price_usd,
      mark_price_usd: currentPrice,
      liq_price_usd: position.liq_price_usd,
      size_usd: nextEntryNotional,
      notional_usd: nextEntryNotional,
      margin_used_usd: nextEntryNotional,
      leverage: position.leverage,
      take_profit_price: position.take_profit_price,
      stop_loss_price: position.stop_loss_price,
      unrealized_pnl_usd: pnlForShort(position.entry_price_usd, currentPrice, nextEntryNotional),
      realized_pnl_usd: nextRealizedPnlUsd,
      fees_usd: nextFeesUsd,
      funding_usd: position.funding_usd || 0,
      strategy_tag: position.strategy_tag,
      mode: 'paper',
      decision_id: position.decision_id,
      source: EXECUTOR_SOURCE,
      raw: nextRaw,
    });
  }

  runDbCliWrite('record-trade', {
    ts,
    symbol: position.asset,
    side: 'buy',
    mode: 'paper',
    simulated: true,
    product_type: 'perps',
    venue: 'paper_engine',
    strategy_family: STRATEGY_FAMILY,
    decision_id: position.decision_id,
    market: position.asset,
    price: currentPrice,
    amount: closingQuantity,
    size_usd: exitNotional,
    out_amount: String(Math.max(0, exitNotional - closeFeeUsd)),
    expected_out_amount: String(exitNotional),
    signature: orderKey,
    quote_price_impact: 0,
    reason: `Paper perp short ${closeKind}: ${exitReason}`,
    strategy_tag: position.strategy_tag,
    realized_pnl_usd: realizedPnlUsd,
    cost_basis_usd: closingEntryNotional,
    exit_reason: exitReason,
    validation_mode: (raw.live_stub || raw.risk?.live_stub) ? 'tiny_live_stub' : 'paper',
    approval_status: (raw.live_stub || raw.risk?.live_stub) ? ((raw.live_approval?.status || raw.risk?.live_approval?.status) || 'telegram_approved') : 'paper_only',
  });

  recordSystemEvent('perp_executor_decision', 'info', `${reductionFraction < 0.999999 ? 'Reduced' : 'Closed'} paper short on ${position.asset}`, {
    mode: MODE,
    strategy_family: STRATEGY_FAMILY,
    product_type: 'perps',
    decision_id: position.decision_id,
    symbol: position.asset,
    exit_reason: exitReason,
    exit_price: currentPrice,
    realized_pnl_usd: realizedPnlUsd,
    gross_pnl_usd: grossPnl,
    fees_usd: totalFeesUsd,
    reduction_fraction: reductionFraction,
    live_stub: Boolean(raw.live_stub || raw.risk?.live_stub),
  });

  if (realizedPnlUsd < 0) {
    recordRiskEvent('perp_paper_loss_realized', 'warning', `Paper short on ${position.asset} ${reductionFraction < 0.999999 ? 'reduced' : 'closed'} at a loss`, {
      strategy_family: STRATEGY_FAMILY,
      decision_id: position.decision_id,
      symbol: position.asset,
      realized_pnl_usd: realizedPnlUsd,
      exit_reason: exitReason,
      daily_loss_cap_usd: DAILY_LOSS_CAP_USD,
      reduction_fraction: reductionFraction,
    });
  }

  return realizedPnlUsd;
}

function evaluateOpenPositions(state) {
  const positions = state.open_positions || [];
  if (!positions.length) return { action: 'none', results: [], remaining_open_positions: 0 };
  const marketMap = latestMarketMap(state.latest_markets);
  const results = [];
  let closedCount = 0;
  let staleCount = 0;

  for (const position of positions) {
    const currentPriceState = currentPriceForPosition(position, marketMap);
    if (!currentPriceState.ok) {
      staleCount += 1;
      recordRiskEvent('perp_position_market_unavailable', 'warning', `Skipping ${position.asset} management due to unavailable market data`, {
        strategy_family: STRATEGY_FAMILY,
        position_key: position.position_key,
        symbol: position.asset,
        reason: currentPriceState.reason,
      });
      results.push({
        action: 'stale_market',
        symbol: position.asset,
        position_key: position.position_key,
        reason: currentPriceState.reason,
      });
      continue;
    }

    const currentPrice = currentPriceState.price;
    const entryPrice = safeNumber(position.entry_price_usd, currentPrice);
    const notionalUsd = safeNumber(position.notional_usd, safeNumber(position.size_usd, 0));
    const unrealizedPnlUsd = pnlForShort(entryPrice, currentPrice, notionalUsd);
    updatePaperPositionMark(position, currentPrice, unrealizedPnlUsd);

    const heldMinutes = minutesSince(position.opened_ts);
    const stopPrice = safeNumber(position.stop_loss_price, Infinity);
    const targetPrice = safeNumber(position.take_profit_price, -Infinity);
    const invalidationPrice = safeNumber(position.raw?.risk?.invalidation?.price, stopPrice);

    if (currentPrice >= stopPrice || currentPrice >= invalidationPrice) {
      const realized = closePaperShort(position, currentPrice, 'stop_or_invalidation_hit');
      closedCount += 1;
      results.push({ action: 'closed', symbol: position.asset, reason: 'stop_or_invalidation_hit', realized_pnl_usd: realized });
      continue;
    }
    if (currentPrice <= targetPrice) {
      const realized = closePaperShort(position, currentPrice, 'take_profit_hit');
      closedCount += 1;
      results.push({ action: 'closed', symbol: position.asset, reason: 'take_profit_hit', realized_pnl_usd: realized });
      continue;
    }
    if (heldMinutes >= MAX_HOLD_MINUTES) {
      const realized = closePaperShort(position, currentPrice, 'time_stop');
      closedCount += 1;
      results.push({ action: 'closed', symbol: position.asset, reason: 'time_stop', realized_pnl_usd: realized });
      continue;
    }

    results.push({
      action: 'hold',
      symbol: position.asset,
      current_price: currentPrice,
      unrealized_pnl_usd: unrealizedPnlUsd,
      held_minutes: heldMinutes,
    });
  }

  if (positions.length > MAX_ONE_POSITION) {
    recordRiskEvent('perp_multiple_open_positions_detected', 'critical', 'Executor found more than one paper perp position; refusing new entries until anomaly is cleared', {
      open_position_count: positions.length,
    });
  }

  return {
    action: closedCount > 0 ? 'managed' : (staleCount > 0 ? 'stale' : 'hold'),
    results,
    closed_count: closedCount,
    stale_count: staleCount,
    remaining_open_positions: Math.max(0, positions.length - closedCount),
  };
}

function inCooldown(state, symbol) {
  const latestGlobalTs = latestFillTsFor(state, () => true) || latestOrderTsFor(state, () => true);
  if (latestGlobalTs && minutesSince(latestGlobalTs) < GLOBAL_COOLDOWN_MINUTES) {
    return { blocked: true, reason: 'global_cooldown', minutes_remaining: GLOBAL_COOLDOWN_MINUTES - minutesSince(latestGlobalTs) };
  }
  const latestSymbolTs =
    latestFillTsFor(state, fill => fill.asset === symbol) ||
    latestOrderTsFor(state, order => order.asset === symbol);
  if (latestSymbolTs && minutesSince(latestSymbolTs) < SYMBOL_COOLDOWN_MINUTES) {
    return { blocked: true, reason: 'symbol_cooldown', minutes_remaining: SYMBOL_COOLDOWN_MINUTES - minutesSince(latestSymbolTs) };
  }
  return { blocked: false };
}

function strategyFromChoice(choice) {
  if (!choice) return null;
  if (choice.type === 'trade') return choice.plan?.signalType || null;
  if (choice.type === 'no_trade' && choice.plan?.blocked) {
    return choice.plan?.lane?.signal_type || choice.decision?.best_short_lane?.signal_type || null;
  }
  return null;
}

function symbolFromChoice(choice) {
  if (!choice) return null;
  if (choice.type === 'trade') return choice.plan?.symbol || choice.decision?.symbol || null;
  return choice.decision?.symbol || null;
}

function summarizeCandidateChoice(choice) {
  if (!choice || !choice.decision) return null;
  const bestShortLane = choice.decision.best_short_lane || null;
  const noTradeLane = findNoTradeLane(choice.decision);
  const selectedLane = choice.type === 'trade'
    ? (choice.plan?.lane || choice.lane || bestShortLane)
    : (choice.lane || noTradeLane || null);
  const shortScore = safeNumber(choice.plan?.compositeScore, safeNumber(bestShortLane?.score, null));
  const noTradeScore = safeNumber(noTradeLane?.score, safeNumber(choice.lane?.signal_type === 'perp_no_trade' ? choice.lane?.score : null, null));
  const selectedScore = choice.type === 'trade'
    ? shortScore
    : safeNumber(selectedLane?.score, noTradeScore);
  return {
    type: choice.type,
    decision_id: choice.decision.decision_id,
    symbol: choice.decision.symbol,
    market: choice.decision.market || choice.decision.symbol,
    selected_signal_type: selectedLane?.signal_type || null,
    selected_score: selectedScore,
    selected_reason: choice.reason || choice.plan?.reason || selectedLane?.reason || null,
    best_short_signal_type: bestShortLane?.signal_type || null,
    best_short_score: safeNumber(bestShortLane?.score, null),
    no_trade_signal_type: noTradeLane?.signal_type || (choice.type === 'no_trade' ? 'perp_no_trade' : null),
    no_trade_score: noTradeScore,
    score_gap_vs_no_trade: shortScore != null && noTradeScore != null ? Number((shortScore - noTradeScore).toFixed(4)) : null,
    blocked_trade: Boolean(choice.plan?.blocked),
    block_reason: choice.plan?.blockReason || null,
    market_age_minutes: safeNumber(choice.plan?.marketAgeMinutes, null),
    invalidation_price: safeNumber(choice.plan?.invalidationPrice, null),
    stop_loss_price: safeNumber(choice.plan?.stopLossPrice, null),
    take_profit_price: safeNumber(choice.plan?.takeProfitPrice, null),
    paper_notional_usd: safeNumber(choice.plan?.paperNotional, null),
    candidate_strategy: strategyFromChoice(choice),
  };
}

function processLiveCommand(state) {
  const command = consumeLiveCommand();
  if (!command) return null;
  if (command.command_type === 'flatten_all') {
    const positions = state.open_positions || [];
    const marketMap = latestMarketMap(state.latest_markets);
    const results = [];
    for (const position of positions) {
      const currentPriceState = currentPriceForPosition(position, marketMap);
      if (!currentPriceState.ok) {
        results.push({ position_key: position.position_key, status: 'skipped', reason: currentPriceState.reason });
        continue;
      }
      closePaperShort(position, currentPriceState.price, 'emergency_flatten_all');
      results.push({ position_key: position.position_key, status: 'flattened', symbol: position.asset });
    }
    clearLiveCommand(command, 'executed', { results });
    recordSystemEvent('perp_flatten_all_completed', 'warning', 'Processed flatten-all emergency command for perp executor', {
      strategy_family: STRATEGY_FAMILY,
      product_type: 'perps',
      command,
      results,
    });
    return { action: 'flatten_all', results, command };
  }
  const target = findOpenPositionByRef(state, command.target_ref);
  if (!target) {
    clearLiveCommand(command, 'rejected', { reason: 'position_not_found' });
    return { action: 'command_rejected', reason: 'position_not_found', command };
  }
  const currentPriceState = currentPriceForPosition(target, latestMarketMap(state.latest_markets));
  if (!currentPriceState.ok) {
    clearLiveCommand(command, 'rejected', { reason: currentPriceState.reason });
    return { action: 'command_rejected', reason: currentPriceState.reason, command };
  }
  const reductionFraction = command.command_type === 'reduce_position' ? clamp(safeNumber(command.reduction_fraction, 0.5) || 0.5, 0.05, 0.95) : 1;
  closePaperShort(target, currentPriceState.price, command.command_type === 'reduce_position' ? 'manual_reduce' : 'manual_close', { reduction_fraction: reductionFraction });
  clearLiveCommand(command, 'executed', { target_position_key: target.position_key, reduction_fraction: reductionFraction });
  recordSystemEvent('perp_manual_position_command_executed', 'warning', 'Processed manual perp position command', {
    strategy_family: STRATEGY_FAMILY,
    product_type: 'perps',
    command_type: command.command_type,
    target_position_key: target.position_key,
    target_decision_id: target.decision_id,
    reduction_fraction: reductionFraction,
  });
  return { action: command.command_type, target_position_key: target.position_key, reduction_fraction: reductionFraction, command };
}

function maybeEnterNewPosition(state, journal, precomputedChoice = null, policyContext = null) {
  if ((state.open_positions || []).length >= MAX_ONE_POSITION) {
    return { action: 'skip', reason: 'max_open_positions' };
  }
  const realizedPnlUsd = safeNumber(state.daily_paper_metrics?.realized_pnl_usd, 0) || 0;
  const tradedNotionalUsd = safeNumber(state.daily_paper_metrics?.trade_notional_usd, 0) || 0;
  if (realizedPnlUsd <= -DAILY_LOSS_CAP_USD) {
    recordRiskEvent('perp_daily_loss_cap_hit', 'warning', 'Daily paper perp loss cap reached; blocking new entries', {
      strategy_family: STRATEGY_FAMILY,
      daily_realized_pnl_usd: realizedPnlUsd,
      daily_loss_cap_usd: DAILY_LOSS_CAP_USD,
    });
    return { action: 'skip', reason: 'daily_loss_cap', realizedPnlUsd };
  }

  if ((tradedNotionalUsd + PAPER_NOTIONAL_USD) > MAX_DAILY_NOTIONAL_USD) {
    recordRiskEvent('perp_daily_notional_cap_hit', 'info', 'Daily paper perp notional cap reached; blocking new entries', {
      strategy_family: STRATEGY_FAMILY,
      traded_notional_usd: tradedNotionalUsd,
      max_daily_notional_usd: MAX_DAILY_NOTIONAL_USD,
    });
    return { action: 'skip', reason: 'daily_notional_cap', tradedNotionalUsd };
  }

  const choice = precomputedChoice || pickEntryDecision(state);
  if (!choice) return { action: 'skip', reason: 'no_eligible_candidate' };

  if (choice.type === 'no_trade') {
    recordExecutorDecision(choice.decision, choice.lane, 'executed', choice.reason, {
      decision_summary: 'no_trade',
      blocked_trade_reason: choice.plan?.blockReason || null,
    });
    recordSystemEvent('perp_executor_decision', 'info', `Perp executor selected no-trade for ${choice.decision.symbol}`, {
      strategy_family: STRATEGY_FAMILY,
      product_type: 'perps',
      decision_id: choice.decision.decision_id,
      symbol: choice.decision.symbol,
      signal_type: choice.lane.signal_type,
      score: choice.lane.score,
      reason: choice.reason,
    });
    return {
      action: 'no_trade',
      symbol: choice.decision.symbol,
      signal_type: choice.lane.signal_type,
      decision_id: choice.decision.decision_id,
      reason: choice.reason,
      score: choice.lane.score,
    };
  }

  const plan = choice.plan;
  const entryRisk = evaluateEntryRiskGuards(state, journal, plan);
  if (entryRisk.blocked) {
    recordRiskEvent('perp_entry_risk_guard_block', 'warning', `Risk guard blocked paper perp entry for ${plan.symbol}`, {
      strategy_family: STRATEGY_FAMILY,
      symbol: plan.symbol,
      decision_id: plan.decisionId,
      block_reason: entryRisk.blockReason,
      guard_context: entryRisk.guardContext,
    });
    recordExecutorDecision(choice.decision, choice.lane, 'skipped', entryRisk.blockReason, {
      decision_summary: 'trade_blocked',
      risk_guard: entryRisk.guardContext,
    });
    return {
      action: 'skip',
      reason: entryRisk.blockReason,
      symbol: plan.symbol,
      signal_type: plan.signalType,
      decision_id: plan.decisionId,
      risk_guard: entryRisk.guardContext,
    };
  }
  const cooldown = inCooldown(state, plan.symbol);
  if (cooldown.blocked) {
    recordRiskEvent('perp_entry_cooldown_block', 'info', `Cooldown blocked paper perp entry for ${plan.symbol}`, {
      strategy_family: STRATEGY_FAMILY,
      symbol: plan.symbol,
      cooldown,
      decision_id: plan.decisionId,
    });
    recordExecutorDecision(choice.decision, choice.lane, 'skipped', cooldown.reason, {
      cooldown,
      decision_summary: 'trade_blocked',
    });
    return {
      action: 'skip',
      reason: cooldown.reason,
      symbol: plan.symbol,
      signal_type: plan.signalType,
      decision_id: plan.decisionId,
    };
  }

  if (LIVE_ENABLED && policyContext?.live_eligible_for_executor) {
    const approvedIntent = loadExecutableApprovedIntent(plan);
    const liveAdapterRequest = buildPerpLiveExecutionRequest(plan, approvedIntent, {
      strategy_family: STRATEGY_FAMILY,
      live_notional_usd: Math.min(Math.max(0.5, LIVE_STUB_NOTIONAL_USD), plan.paperNotional, MAX_PAPER_NOTIONAL_USD),
      max_quote_drift_bps: MAX_QUOTE_DRIFT_BPS,
      max_spread_bps: MAX_ESTIMATED_SPREAD_BPS,
      max_slippage_bps: MAX_ESTIMATED_SLIPPAGE_BPS,
      max_planned_leverage: MAX_PLANNED_LEVERAGE,
    });
    if (!approvedIntent) {
      const pendingIntent = prepareLiveApprovalIntent(plan, choice, policyContext);
      recordExecutorDecision(choice.decision, choice.lane, 'skipped', 'awaiting_telegram_approval', {
        decision_summary: 'awaiting_approval',
        approval_intent: pendingIntent,
      });
      return {
        action: 'awaiting_approval',
        reason: 'awaiting_telegram_approval',
        symbol: plan.symbol,
        signal_type: plan.signalType,
        decision_id: plan.decisionId,
        approval_intent: pendingIntent,
        live_adapter_request: liveAdapterRequest,
      };
    }

    const liveSubmitAttempt = submitPerpLiveOrder(liveAdapterRequest);
    const livePlan = buildLiveStubPlan(plan, approvedIntent);
    const entryExecution = openPaperShort(livePlan, state, journal);
    markApprovalIntentTerminal(approvedIntent, 'executed', {
      execution_result: {
        action: entryExecution.action,
        reason: entryExecution.reason,
        entry_price: entryExecution.entry_price,
        size_usd: entryExecution.size_usd,
        live_adapter_request: liveAdapterRequest,
        live_submit_attempt: liveSubmitAttempt,
      },
    });
    const actionKey = `open:${livePlan.decisionId}`;
    upsertJournalAction(journal, actionKey, {
      approval_id: approvedIntent.approval_id,
      approval_status: 'telegram_approved',
      live_stub: true,
      last_risk_decision: entryExecution.reason || 'live_stub_opened',
    });
    recordSystemEvent('perp_live_stub_entry_submitted', 'warning', `Tiny live stub entry approved for ${livePlan.symbol}`, {
      strategy_family: STRATEGY_FAMILY,
      product_type: 'perps',
      approval_id: approvedIntent.approval_id,
      decision_id: livePlan.decisionId,
      symbol: livePlan.symbol,
      signal_type: livePlan.signalType,
      size_usd: livePlan.paperNotional,
      stop_loss_price: livePlan.stopLossPrice,
      take_profit_price: livePlan.takeProfitPrice,
      execution_result: entryExecution,
      live_adapter_request: liveAdapterRequest,
      live_submit_attempt: liveSubmitAttempt,
      live_adapter_capabilities: adapterCapabilities(),
    });
    recordExecutorDecision(choice.decision, choice.lane, 'executed', 'live_stub_opened_after_telegram_approval', {
      decision_summary: entryExecution.action === 'partial_fill' ? 'live_stub_partial_fill' : 'live_stub_opened',
      entry_price: entryExecution.entry_price,
      size_usd: entryExecution.size_usd,
      stop_loss_price: livePlan.stopLossPrice,
      take_profit_price: livePlan.takeProfitPrice,
      approval_id: approvedIntent.approval_id,
      action_state: entryExecution.action_state,
      live_adapter_request: liveAdapterRequest,
      live_submit_attempt: liveSubmitAttempt,
      live_adapter_capabilities: adapterCapabilities(),
    });
    return {
      ...entryExecution,
      action: entryExecution.action,
      execution_mode: 'live_stub',
      approval_id: approvedIntent.approval_id,
      approval_status: 'telegram_approved',
      live_adapter_request: liveAdapterRequest,
      live_submit_attempt: liveSubmitAttempt,
      live_adapter_capabilities: adapterCapabilities(),
    };
  }

  const entryExecution = openPaperShort(plan, state, journal);
  recordExecutorDecision(choice.decision, choice.lane, 'executed', entryExecution.reason || 'paper_short_opened', {
    decision_summary: entryExecution.action === 'partial_fill' ? 'trade_partial_fill' : 'trade_opened',
    entry_price: entryExecution.entry_price,
    size_usd: entryExecution.size_usd,
    stop_loss_price: plan.stopLossPrice,
    take_profit_price: plan.takeProfitPrice,
    action_state: entryExecution.action_state,
  });
  return entryExecution;
}

function main() {
  ensureDataDir();
  if (!acquireLock()) return;

  try {
    if (fs.existsSync(KILL_SWITCH_FILE)) {
      recordRiskEvent('perp_executor_disabled', 'warning', 'Perp paper executor disabled via kill switch', {
        kill_switch_file: KILL_SWITCH_FILE,
      });
      return;
    }

    const strategyControls = readStrategyControls();
    const journal = loadJournal();
    const state = readExecutorState();
    if ((state.open_positions || []).length > MAX_ONE_POSITION) {
      log('multiple open positions detected; executor will manage all current exposure and refuse new entries');
    }

    const recoverySummary = reconcileJournalWithState(state, journal);
    const reconciledState = recoverySummary.recovered_orphan_positions > 0 || recoverySummary.recovered_timeout_actions > 0
      ? readExecutorState()
      : state;
    const positionResult = evaluateOpenPositions(reconciledState);
    const postPositionState = positionResult.closed_count > 0 ? readExecutorState() : reconciledState;
    const commandResult = processLiveCommand(postPositionState);
    const refreshedState = commandResult ? readExecutorState() : postPositionState;
    const remainingOpenPositions = refreshedState.open_positions || [];
    const candidateChoice = pickEntryDecision(refreshedState);
    const candidateChoiceSummary = summarizeCandidateChoice(candidateChoice);
    const pilotPolicy = resolvePilotPolicyContext(
      strategyControls,
      strategyFromChoice(candidateChoice),
      symbolFromChoice(candidateChoice),
    );
    recordPilotPolicyOutcome(pilotPolicy);
    const entryResult = remainingOpenPositions.length === 0
      ? maybeEnterNewPosition(refreshedState, journal, candidateChoice, pilotPolicy)
      : { action: 'skip', reason: 'active_position_exists', open_position_count: remainingOpenPositions.length };
    const finalState = ['opened', 'partial_fill'].includes(entryResult.action) ? readExecutorState() : refreshedState;
    const postActionRecoverySummary = reconcileJournalWithState(finalState, journal);

    const summary = {
      ts: new Date().toISOString(),
      requested_mode: LIVE_REQUESTED ? 'live' : 'paper',
      active_mode: MODE,
      open_positions_before: (state.open_positions || []).length,
      daily_realized_pnl_usd: safeNumber(refreshedState.daily_paper_metrics?.realized_pnl_usd, 0),
      daily_trade_notional_usd: safeNumber(refreshedState.daily_paper_metrics?.trade_notional_usd, 0),
      candidate_choice: candidateChoiceSummary,
      pilot_policy: pilotPolicy,
      recovery: {
        initial: recoverySummary,
        final: postActionRecoverySummary,
        journal_file: JOURNAL_FILE,
      },
      active_actions: postActionRecoverySummary.active_actions,
      latest_action: entryResult.action_state || null,
      position_result: positionResult,
      command_result: commandResult,
      live_approval_intent: loadLiveApprovalIntent(),
      live_command_state: loadLiveCommandState(),
      entry_result: entryResult,
    };
    recordSystemEvent('perp_executor_cycle', 'info', 'Perp paper executor cycle completed', {
      strategy_family: STRATEGY_FAMILY,
      product_type: 'perps',
      summary,
    });
    log('perps-auto-trade completed', summary);
    console.log(JSON.stringify(summary));
  } catch (err) {
    try {
      recordRiskEvent('perp_executor_error', 'warning', err.message, {
        strategy_family: STRATEGY_FAMILY,
        mode: MODE,
      });
    } catch {}
    console.error(`perps-auto-trade failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

main();
