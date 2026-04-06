Perps live execution adapter scaffold

Purpose
- Defines the non-executing boundary where a human developer can later wire real Jupiter perps order submission.
- Keeps the current executor fail-closed and stub-only.

Files
- trading_system/perps_live_execution_adapter.mjs
- perps-auto-trade.mjs

Required adapter functions
- adapterCapabilities()
- buildPerpLiveExecutionRequest(plan, approvalIntent, context)
- submitPerpLiveOrder(request)

Expected future execution functions for a real implementation
- submit live entry order
- cancel live order
- reduce live position
- flatten all live positions
- fetch live order status
- fetch live fills
- fetch live positions

Current scaffold template exports
- submitPerpLiveOrder(request)
- cancelPerpLiveOrder(orderRef, context)
- reducePerpLivePosition(positionRef, reductionFraction, context)
- flattenAllPerpLivePositions(context)
- fetchPerpLiveOrderStatus(orderRef, context)
- fetchPerpLiveFills(ref, context)
- fetchPerpLivePositions(context)

Request contract
- approval.approval_id
- approval.decision_id
- idempotency.action_key
- idempotency.entry_order_key
- market.symbol
- market.side
- market.signal_type
- risk.entry_notional_usd
- risk.entry_price
- risk.stop_loss_price
- risk.take_profit_price
- risk.max_quote_drift_bps
- risk.max_spread_bps
- risk.max_slippage_bps
- risk.max_planned_leverage

Safety requirements for any future human implementation
- Must preserve Telegram approval gating exactly
- Must preserve fail-closed behavior on ambiguous submit
- Must preserve deterministic idempotency keys
- Must record orders/fills/positions back into SQLite
- Must keep journal reconciliation as the source of truth for recovery
- Must not submit if policy/risk/approval checks are missing

Current scaffold status
- Real submission intentionally not implemented
- submitPerpLiveOrder() returns not_implemented
- perps-auto-trade.mjs may prepare adapter requests for inspection while still using the stub path
