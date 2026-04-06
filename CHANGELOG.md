# Changelog

## v0.1.0 - 2026-04-06

Initial public perps export.

Highlights:
- exported `perps-monitor.mjs` and `perps-auto-trade.mjs`
- included perps notifier / approval bridge
- included live adapter scaffold, fixtures, and handoff docs
- added portability helpers (`runtime-config.mjs`, `trading_system/runtime_config.py`)
- removed obvious spot-only tooling from the public export
- added perps-facing wrapper entrypoints (`perps_db_cli.py`, `perps_sync_db.py`)
- added MIT license and public repo metadata/topics

## v0.1.1 - 2026-04-06

Public OSS surface hardening.

Highlights:
- replaced the public wrapper with a truly perps-only CLI surface in `trading_system/perps_db_cli.py`
- pointed runtime/config examples at the perps-only CLI path
- added GitHub Actions validation workflow
- expanded README with stability guidance and OSS roadmap

- added `trading_system/perps_core.py` as a smaller public module surface
- added `docs/reference/perps-schema.md`
- added GitHub Actions badge to README
- added `trading_system/perps_db_impl.py` as a public implementation shim
- added `tests/test_public_perps_surface.py` and wired it into CI
- added `examples/` with public CLI commands and sample payloads
