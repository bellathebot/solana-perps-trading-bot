#!/usr/bin/env node

// Mock example only. This file demonstrates the normalized return shapes a human
// developer should preserve when wiring real Jupiter perps live calls.
// It does NOT submit live orders.

import {
  adapterCapabilities,
  buildPerpLiveExecutionRequest,
  submitPerpLiveOrder,
  cancelPerpLiveOrder,
  reducePerpLivePosition,
  flattenAllPerpLivePositions,
  fetchPerpLiveOrderStatus,
  fetchPerpLiveFills,
  fetchPerpLivePositions,
} from './perps_live_execution_adapter.mjs';

export function exampleSubmitEntry(request) {
  return {
    implemented: false,
    action: 'mock_submitted',
    reason: 'example_only_do_not_use_for_live_trading',
    adapter_name: adapterCapabilities().adapter_name,
    order_ref: request?.idempotency?.entry_order_key || null,
    order_status: 'submitted',
    fill_status: 'unknown',
    ambiguous_submit: false,
    request,
  };
}

export function exampleCancelOrder(orderRef) {
  return {
    implemented: false,
    action: 'mock_cancelled',
    reason: 'example_only_do_not_use_for_live_trading',
    adapter_name: adapterCapabilities().adapter_name,
    order_ref: orderRef,
    order_status: 'cancelled',
  };
}

export function exampleReducePosition(positionRef, reductionFraction) {
  return {
    implemented: false,
    action: 'mock_reduced',
    reason: 'example_only_do_not_use_for_live_trading',
    adapter_name: adapterCapabilities().adapter_name,
    position_ref: positionRef,
    reduction_fraction: reductionFraction,
    order_status: 'submitted',
  };
}

export function exampleFlattenAll() {
  return {
    implemented: false,
    action: 'mock_flatten_all',
    reason: 'example_only_do_not_use_for_live_trading',
    adapter_name: adapterCapabilities().adapter_name,
    order_status: 'submitted',
  };
}

export function exampleFetchOrderStatus(orderRef) {
  return {
    implemented: false,
    action: 'mock_order_status',
    reason: 'example_only_do_not_use_for_live_trading',
    adapter_name: adapterCapabilities().adapter_name,
    order_ref: orderRef,
    order_status: 'open',
  };
}

export function exampleFetchFills(ref) {
  return {
    implemented: false,
    action: 'mock_fills',
    reason: 'example_only_do_not_use_for_live_trading',
    adapter_name: adapterCapabilities().adapter_name,
    ref,
    fills: [],
  };
}

export function exampleFetchPositions() {
  return {
    implemented: false,
    action: 'mock_positions',
    reason: 'example_only_do_not_use_for_live_trading',
    adapter_name: adapterCapabilities().adapter_name,
    positions: [],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = {
    plan: {
      decisionId: 'mock-example-sol-short-001',
      symbol: 'SOL',
      signalType: 'perp_short_continuation',
      paperNotional: 1,
      entryPrice: 82.5,
      stopLossPrice: 83.16,
      takeProfitPrice: 81.18,
    },
    approvalIntent: {
      approval_id: 'perp-approval:mock-example-sol-short-001',
      decision_id: 'mock-example-sol-short-001',
      approved_at: '2099-01-01T00:00:00.000Z',
    },
    context: {
      strategy_family: 'tiny_live_pilot',
      live_notional_usd: 1,
      max_quote_drift_bps: 40,
      max_spread_bps: 20,
      max_slippage_bps: 25,
      max_planned_leverage: 1,
    },
  };

  const request = buildPerpLiveExecutionRequest(fixture.plan, fixture.approvalIntent, fixture.context);
  console.log(JSON.stringify({
    scaffold_submit: submitPerpLiveOrder(request),
    scaffold_cancel: cancelPerpLiveOrder('order-1'),
    scaffold_reduce: reducePerpLivePosition('position-1', 0.5),
    scaffold_flatten: flattenAllPerpLivePositions(),
    scaffold_status: fetchPerpLiveOrderStatus('order-1'),
    scaffold_fills: fetchPerpLiveFills('order-1'),
    scaffold_positions: fetchPerpLivePositions(),
    mock_submit_shape: exampleSubmitEntry(request),
    mock_cancel_shape: exampleCancelOrder('order-1'),
    mock_reduce_shape: exampleReducePosition('position-1', 0.5),
    mock_flatten_shape: exampleFlattenAll(),
    mock_status_shape: exampleFetchOrderStatus('order-1'),
    mock_fills_shape: exampleFetchFills('order-1'),
    mock_positions_shape: exampleFetchPositions(),
  }, null, 2));
}
