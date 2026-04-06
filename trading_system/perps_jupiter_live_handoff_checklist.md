Perps Jupiter live handoff checklist

Purpose
- Human-developer checklist for wiring the real Jupiter perps live execution adapter while preserving all existing approval/risk/journal controls.

Current boundary
- Executor: perps-auto-trade.mjs
- Adapter scaffold: trading_system/perps_live_execution_adapter.mjs
- Contract: trading_system/perps_live_execution_adapter_contract.md
- Preflight: trading_system/perps_readiness_preflight.py

Required human implementation tasks
1. Replace submitPerpLiveOrder(request) with real Jupiter perps entry submission
2. Add cancel live order support
3. Add reduce position support
4. Add flatten-all support
5. Add order-status lookup
6. Add fills lookup with stable fill identity
7. Add position lookup
8. Normalize venue errors into deterministic failure classes
9. Preserve idempotency keys from request.idempotency
10. Preserve fail-closed handling on ambiguous submits/timeouts
11. Write real orders/fills/positions back into SQLite via existing DB CLI helpers or equivalent extensions
12. Keep journal reconciliation authoritative for recovery

Preflight checks before any real implementation test
- perps runtime env loaded
- approval bridge working
- notifier working
- journal file writable
- DB writable
- risk/system events recording correctly
- approval file and command file paths correct
- no kill switch present

Mandatory safety invariants
- Never submit without exact approved approval_id / decision_id match
- Never bypass pilot policy eligibility
- Never bypass symbol allowlist
- Never bypass spread/slippage/leverage/drawdown guards
- Never resubmit blindly after ambiguous timeout
- Always emit deterministic order/fill keys for reconciliation

Acceptance tests a human implementer should run after wiring
- live request still denied when pilot decision missing
- live request still denied when policy unapproved
- live request still denied on product mismatch
- live request still denied on non-actionable strategy
- approval request created when eligible and not yet approved
- approved live request calls real adapter path
- ambiguous submit fails closed and journals pending/submitted state
- fills and positions reconcile back into SQLite without duplicates
- flatten/reduce commands execute and journal correctly

Current known truth
- System is supervised-live-stub ready
- System is not true-live ready until the adapter is implemented by a human developer
