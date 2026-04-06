Perps live execution adapter mock example

Purpose
- Human-oriented example of the normalized payloads a real Jupiter perps live adapter should preserve.
- This document does not contain live execution code.

Example submit-entry result shape
{
  "implemented": false,
  "action": "mock_submitted",
  "reason": "example_only_do_not_use_for_live_trading",
  "adapter_name": "jupiter-perps-live-execution-adapter-scaffold",
  "order_ref": "open:fixture-sol-short-001:entry:1",
  "order_status": "submitted",
  "fill_status": "unknown"
}

Example cancel-order result shape
{
  "implemented": false,
  "action": "mock_cancelled",
  "reason": "example_only_do_not_use_for_live_trading",
  "adapter_name": "jupiter-perps-live-execution-adapter-scaffold",
  "order_ref": "order-1",
  "order_status": "cancelled"
}

Example reduce-position result shape
{
  "implemented": false,
  "action": "mock_reduced",
  "reason": "example_only_do_not_use_for_live_trading",
  "adapter_name": "jupiter-perps-live-execution-adapter-scaffold",
  "position_ref": "position-1",
  "reduction_fraction": 0.5,
  "order_status": "submitted"
}

Example fetch-status result shape
{
  "implemented": false,
  "action": "mock_order_status",
  "reason": "example_only_do_not_use_for_live_trading",
  "adapter_name": "jupiter-perps-live-execution-adapter-scaffold",
  "order_ref": "order-1",
  "order_status": "open"
}
