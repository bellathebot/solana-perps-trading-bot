#!/usr/bin/env node

const ADAPTER_VERSION = 1;
const ADAPTER_NAME = 'jupiter-perps-live-execution-adapter-scaffold';

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function adapterCapabilities() {
  return {
    adapter_name: ADAPTER_NAME,
    adapter_version: ADAPTER_VERSION,
    implemented: false,
    live_order_submission_supported: false,
    supports: {
      submit_entry: false,
      cancel_order: false,
      reduce_position: false,
      flatten_all: false,
      fetch_order_status: false,
      fetch_fills: false,
      fetch_positions: false,
    },
    required_runtime_inputs: [
      'wallet/key context for Jupiter perps',
      'symbol/market resolver',
      'entry order submit',
      'cancel/replace',
      'fill lookup',
      'position lookup',
      'error normalization',
      'idempotency persistence',
    ],
  };
}

export function buildPerpLiveExecutionRequest(plan, approvalIntent, context = {}) {
  const entryNotionalUsd = safeNumber(context.live_notional_usd, safeNumber(plan.paperNotional, 0));
  return {
    adapter_name: ADAPTER_NAME,
    adapter_version: ADAPTER_VERSION,
    prepared_at: nowIso(),
    execution_mode: 'real_live_unimplemented',
    implemented: false,
    action: 'submit_entry',
    approval: {
      approval_id: approvalIntent?.approval_id || null,
      decision_id: approvalIntent?.decision_id || plan.decisionId || null,
      approved_at: approvalIntent?.approved_at || null,
    },
    idempotency: {
      action_key: `open:${plan.decisionId}`,
      entry_order_key: `open:${plan.decisionId}:entry:1`,
      expected_fill_key_prefix: `open:${plan.decisionId}:fill`,
    },
    market: {
      symbol: plan.symbol,
      signal_type: plan.signalType,
      side: 'sell',
      strategy_family: context.strategy_family || 'tiny_live_pilot',
    },
    risk: {
      entry_notional_usd: entryNotionalUsd,
      entry_price: safeNumber(plan.entryPrice, null),
      stop_loss_price: safeNumber(plan.stopLossPrice, null),
      take_profit_price: safeNumber(plan.takeProfitPrice, null),
      max_quote_drift_bps: safeNumber(context.max_quote_drift_bps, null),
      max_spread_bps: safeNumber(context.max_spread_bps, null),
      max_slippage_bps: safeNumber(context.max_slippage_bps, null),
      max_planned_leverage: safeNumber(context.max_planned_leverage, null),
    },
    reconciliation_contract: {
      order_status_required: ['submitted', 'open', 'filled', 'cancelled', 'rejected'],
      fill_identity_required: true,
      position_snapshot_required: true,
      ambiguous_submit_must_fail_closed: true,
    },
    notes: [
      'Scaffold only. Real order submission intentionally unimplemented.',
      'Human developer must replace submitPerpLiveOrder() with venue-specific live calls.',
    ],
  };
}

export function submitPerpLiveOrder(request) {
  return {
    implemented: false,
    action: 'not_implemented',
    reason: 'real_perps_live_execution_not_available_in_scaffold',
    adapter_name: ADAPTER_NAME,
    request,
  };
}

export function cancelPerpLiveOrder(orderRef, context = {}) {
  return {
    implemented: false,
    action: 'not_implemented',
    reason: 'cancel_perp_live_order_not_available_in_scaffold',
    adapter_name: ADAPTER_NAME,
    order_ref: orderRef,
    context,
  };
}

export function reducePerpLivePosition(positionRef, reductionFraction, context = {}) {
  return {
    implemented: false,
    action: 'not_implemented',
    reason: 'reduce_perp_live_position_not_available_in_scaffold',
    adapter_name: ADAPTER_NAME,
    position_ref: positionRef,
    reduction_fraction: reductionFraction,
    context,
  };
}

export function flattenAllPerpLivePositions(context = {}) {
  return {
    implemented: false,
    action: 'not_implemented',
    reason: 'flatten_all_perp_live_positions_not_available_in_scaffold',
    adapter_name: ADAPTER_NAME,
    context,
  };
}

export function fetchPerpLiveOrderStatus(orderRef, context = {}) {
  return {
    implemented: false,
    action: 'not_implemented',
    reason: 'fetch_perp_live_order_status_not_available_in_scaffold',
    adapter_name: ADAPTER_NAME,
    order_ref: orderRef,
    context,
  };
}

export function fetchPerpLiveFills(ref, context = {}) {
  return {
    implemented: false,
    action: 'not_implemented',
    reason: 'fetch_perp_live_fills_not_available_in_scaffold',
    adapter_name: ADAPTER_NAME,
    ref,
    context,
  };
}

export function fetchPerpLivePositions(context = {}) {
  return {
    implemented: false,
    action: 'not_implemented',
    reason: 'fetch_perp_live_positions_not_available_in_scaffold',
    adapter_name: ADAPTER_NAME,
    context,
  };
}
