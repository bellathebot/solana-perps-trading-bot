# Release Notes - v0.1.1

Release date: 2026-04-06

Summary:
This update hardens the public repo surface for outside users.

Changes:
- `perps_db_cli.py` is now a true perps-only public CLI surface
- runtime config now points the main entrypoints at the perps-only CLI path
- GitHub Actions validation added
- README expanded with stability guidance and OSS roadmap

Still intentionally not implemented:
- true live perps order placement
