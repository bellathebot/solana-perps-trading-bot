# Release Notes - v0.1.0

Release date: 2026-04-06

Summary:
This is the first public export of the current Solana perps trading workspace.

Included:
- perps monitor
- paper-first perps executor
- perps notifier / approval bridge
- SQLite-backed persistence/reporting
- adapter scaffold for future live wiring

Not included:
- wallet keys
- Telegram bot token
- local runtime state / DB contents
- older spot-only operator tooling

Known limitations:
- true live perps order placement is not implemented
- some shared internals still come from the broader mixed runtime lineage
