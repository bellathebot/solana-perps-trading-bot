# Perps Trader Upgrade Implementation Plan

> **For Hermes:** Execute this plan in order without pausing between phases unless validation fails.

**Goal:** Upgrade the current paper-first Solana perps trader with richer features, multi-gate candidate selection, smarter exits, more realistic simulation, stronger analytics, portfolio-level controls, and broader test coverage.

**Architecture:** Keep the public perps-native stack (`perps-monitor.mjs` -> `perps_db_cli.py` -> `perps_db_impl.py`, plus `perps-auto-trade.mjs`) but split signal computation into a dedicated signal engine, push richer candidate metadata into SQLite, and let the executor consume explicit eligibility/setup/execution gates instead of one blended threshold.

**Tech Stack:** Node.js, Python 3, SQLite, Jupiter CLI, public perps-native repo modules.

---

## Phase 1: Signal and feature enrichment
- Create `perps-signal-engine.mjs`
- Add richer market features:
  - 1m / 5m / 15m / 60m returns
  - rolling realized vol
  - VWAP-style intraday reference
  - trend slope
  - relative strength/weakness vs basket
  - time bucket
  - bounce failure / breakout-retest quality
- Emit explicit lane metadata:
  - eligibility score
  - setup quality score
  - execution quality score
  - expected edge after costs
  - score gap vs no-trade
  - regime family / setup family

## Phase 2: Analytics and policy layer
- Extend `perps_db_impl.py` to persist and summarize richer perps candidate metadata
- Improve policy generation using:
  - sample size
  - realized paper performance
  - candidate forward-edge observations
  - drawdown / consecutive loss checks
- Strengthen executor-state reporting for portfolio and candidate competition

## Phase 3: Executor improvements
- Replace single blended-entry logic with 3 gates:
  - eligibility
  - setup quality
  - execution quality
- Add portfolio-level controls:
  - correlated exposure cap
  - gross notional cap
  - cluster concentration cap
  - slowdown after loss clusters
- Improve decision selection:
  - score gap vs no-trade
  - expected edge after costs hurdle
  - symbol/cluster dedupe

## Phase 4: Smarter exits and post-entry monitoring
- Add partial-profit logic around 1R
- Add trailing stop logic after favorable move
- Add degradation exits if execution/market quality worsens
- Track MAE/MFE and post-entry telemetry in position raw state

## Phase 5: More realistic simulation
- Simulate slippage with volatility/liquidity scaling
- Simulate partial fills with environment + feature-aware defaults
- Simulate stale quote rejection and quote drift with richer telemetry
- Record live-readiness telemetry for later supervised-live work

## Phase 6: Tests and docs
- Add/expand public perps tests
- Update schema docs, README, examples, and roadmap text
- Run full validation and keep npm shortcut flow green
