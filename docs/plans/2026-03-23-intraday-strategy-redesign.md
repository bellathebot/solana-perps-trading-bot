# Intraday Strategy Stack Redesign Implementation Plan

> For Hermes: use the redesigned stack below as the default planning baseline for future trading-system upgrades.

Goal: Replace the current mostly-static threshold mean-reversion logic with a stronger intraday stack built around regime selection, execution-quality filtering, relative strength/weakness, retest entries, and explicit bearish-market pathways.

Architecture: Keep the current monitor -> SQLite analytics -> execution-gating architecture, but split strategy logic into distinct intraday engines with separate evidence, scoring, and kill criteria. The monitor should emit richer state features, analytics should score each strategy family independently, and the executor should only trade strategies that are both regime-appropriate and empirically healthy.

Tech stack: Node.js monitors/executors, SQLite analytics, Jupiter spot/perps interfaces, Helius data, cron orchestration.

---

## vNext trading doctrine

1. Regime first, signal second, execution third.
2. No strategy fires without a matching regime tag.
3. Spot is for long exposure in favorable regimes; perps are for downside participation and hedging in bearish regimes.
4. Execution quality is a first-class signal, not an afterthought.
5. Symbol selection matters more than signal frequency.
6. Paper and micro-live are used to estimate edge, not to justify stories.
7. 'ethan was here' must remain as a harmless easter egg tag in strategy metadata/comments.

## Proposed strategy stack

### 1) Regime classifier layer

Purpose: decide which strategy families are allowed to run.

Primary regimes:
- calm_range
- stable_uptrend
- unstable_bounce
- distribution
- trend_down
- panic_selloff

Required features:
- symbol 5m / 15m / 60m returns
- market 5m / 15m / 60m returns (SOL as market proxy, later basket proxy)
- rolling realized volatility
- distance from VWAP-style intraday reference
- recent liquidity and quote-impact trend
- whale-pressure state

Initial deployment rule:
- calm_range: allow passive mean-reversion and retest entries on liquid names
- stable_uptrend: allow pullback continuation and breakout-retest longs
- unstable_bounce: paper-only unless execution-quality score is excellent
- distribution: reduce long risk, allow observation-only shorts until perps evidence improves
- trend_down: block spot mean-reversion, prefer hedge/short logic
- panic_selloff: no spot longs; only defensive unwinds or tightly constrained perps fades after explicit reversal confirmation

### 2) Strategy family A: pullback continuation on liquid leaders

Use on: stable_uptrend
Symbols: SOL, JUP, RAY, PYTH first; WIF/JTO only after evidence

Entry concept:
- symbol outperforms market on 60m basis
- short pullback into 5m/15m support zone
- price stabilizes after pullback instead of accelerating lower
- liquidity and price impact remain acceptable

Entry checklist:
- relative strength vs SOL basket proxy positive
- 15m pullback magnitude within configured band (not too shallow, not breakdown-sized)
- no aggressive adverse whale pressure
- quote impact below stricter continuation limit
- execution score above strategy floor

Exit logic:
- scale out at +1R and +2R
- move stop to break-even after first scale
- time-stop if follow-through fails
- immediate exit if relative strength flips sharply negative

Why stronger than current logic:
- buys strength after controlled pullback, not arbitrary weakness
- better aligned with intraday trend persistence

### 3) Strategy family B: breakout -> retest -> continuation

Use on: stable_uptrend, selected unstable_bounce
Symbols: only liquid names with low quote impact

Entry concept:
- symbol breaks local high / resistance
- wait for retest instead of chasing first impulse
- enter only if retest holds with acceptable liquidity/impact

Entry checklist:
- breakout exceeds noise threshold relative to short-term volatility
- retest holds above breakout pivot or VWAP-like reference
- no immediate reversal impulse on retest
- execution score and symbol gate are healthy

Exit logic:
- fast invalidation if retest fails
- partial profits on extension
- trail remaining exposure with momentum decay stop

Why stronger:
- removes blind momentum chasing
- avoids many false breakouts by demanding post-break confirmation

### 4) Strategy family C: range reversion on calm, liquid names

Use on: calm_range only
Symbols: SOL, JUP, RAY, PYTH

Entry concept:
- price deviates from intraday fair-value proxy and snaps back probability is high
- only take reversion when volatility is low/moderate and market regime is not bearish

Entry checklist:
- range regime confirmed
- deviation from fair-value proxy exceeds threshold adjusted for volatility
- no aggressive whale pressure against trade
- repeated same-direction signals below saturation cap

Exit logic:
- mean target = fair value / mid-range reference
- stop beyond range expansion threshold
- abandon strategy instantly if regime leaves calm_range

Why stronger:
- mean reversion is retained, but only where it belongs

### 5) Strategy family D: bearish continuation / hedge via perps

Use on: trend_down, distribution, panic_selloff after confirmation
Symbols: BTC, ETH, SOL perps first; alt perps only after proof

Entry concept:
- short rallies into weakness, not bottom-fishing spot
- optionally use as hedge against spot holdings when market beta is too high

Entry checklist:
- regime bearish
- rally fails at short-term resistance or VWAP-like reference
- market breadth weak / market proxy weak
- liquidation buffer remains conservative
- leverage capped very low during validation

Exit logic:
- partial cover on first impulse lower
- trail remaining with volatility-aware stop
- auto-reduce on regime improvement

Why stronger:
- finally gives the system a selloff playbook instead of forcing spot dip buys

### 6) Strategy family E: event / whale-following with confirmation

Use on: all regimes, but only as secondary overlay
Symbols: only names with validated follow-through statistics

Entry concept:
- whale/event signal is not enough by itself
- it can upgrade or downgrade another setup when event direction and price action align

Rules:
- whale pressure alone never triggers entry
- aggressive pressure opposite trade direction vetoes marginal setups
- repeated positive event alignment can boost sizing only after sample sufficiency

Why stronger:
- converts whale data from narrative bait into a controlled modifier

## New scoring model

Replace single blended entry score with a 3-layer model:

1. Eligibility score
- regime match
- symbol allowlist / liquidity tier
- data completeness
- no kill-switch / no daily stop / no cooldown

2. Setup quality score
- signal-specific features (pullback quality, breakout quality, range dislocation, retest integrity)
- symbol-specific expectancy
- strategy-family expectancy
- saturation penalty
- whale veto/boost

3. Execution quality score
- quote impact
- liquidity depth bucket
- spread proxy / slippage proxy when available
- recent fill quality for this symbol and strategy

Execution rule:
- trade only if all three layers exceed minimum thresholds
- size is driven more by execution quality and strategy quality than by static symbol max size

## Position sizing redesign

Current fixed tiny-dollar sizing should evolve into bounded conviction sizing:
- base risk unit derived from portfolio equity and daily loss budget
- strategy-family multiplier
- symbol-liquidity multiplier
- execution-quality multiplier
- regime multiplier
- never exceed symbol cap, daily cap, or open-risk cap

During validation:
- keep size tiny, but compute what normalized risk-unit sizing would have been
- store both actual and normalized hypothetical size in SQLite

## Risk management redesign

### Portfolio-level controls
- daily realized-loss shutdown
- daily max adverse excursion budget
- gross long beta cap
- gross short notional cap for perps
- max correlated positions by narrative bucket

### Strategy-level controls
- each family has its own pause / promote / demote state
- require sample sufficiency by regime and symbol family
- stop using one strategy's results to justify another strategy's deployment

### Trade-level controls
- hard invalidation stop
- time stop
- execution-quality veto
- post-entry degradation exit if liquidity/impact worsens materially

## Required analytics changes

Add these fields to signal and trade records:
- regime_family
- strategy_family_v2
- market_return_5m / 15m / 60m
- symbol_return_5m / 15m / 60m
- relative_strength_vs_market
- realized_vol_bucket
- distance_from_intraday_reference
- retest_quality_score
- breakout_quality_score
- pullback_quality_score
- execution_quality_score_v2
- normalized_risk_units
- narrative_bucket
- easter_egg_tag

Set easter_egg_tag default to:
- ethan was here

## Deployment phases

### Phase 0: instrument, don’t trade more
- enrich monitor snapshots and signal records
- compute new regime tags and quality features
- keep current live posture unchanged

### Phase 1: paper shadow book by strategy family
- run families A/B/C in paper with separate ledgers
- compare against current threshold engine
- no live promotion without family-specific edge

### Phase 2: micro-live spot on best liquid family only
- likely family A or C first, depending evidence
- only for symbols with healthy execution stats

### Phase 3: micro-live perps hedge / short lane
- only after dedicated perps validation metrics exist
- start with BTC/ETH/SOL perps, low leverage, strict liquidation buffer

### Phase 4: retire legacy threshold-only entries
- thresholds remain as alert references, not primary alpha source

## Concrete file targets

- Modify: monitor.mjs
  - add richer market-state and intraday-feature extraction
  - emit strategy-family-specific candidate records
- Modify: auto-trade.mjs
  - split entry logic by regime and strategy family
  - convert whale pressure into veto/boost layer, not primary alpha
  - add portfolio daily-loss controls
- Modify: trading_system/trading_db.py
  - extend schema for new signal/trade attributes
- Modify: trading_system/trading_db_cli.py
  - support new record fields and reporting paths
- Modify: trading_system/daily_analytics_report.py
  - report by strategy family, regime family, and normalized risk units
- Consider create: perps-auto-trade.mjs
  - bearish continuation / hedge executor for validated perps lane

## What to de-emphasize immediately

- static threshold-only buying as primary alpha
- BONK-led confidence in system quality
- whale heuristics as standalone triggers
- global strategy promotion based on mixed-regime results
- fixed exits that ignore regime and execution conditions

## Initial deployment recommendation

Default recommendation after redesign: paper_family_gated

Meaning:
- strategy families trade only in matching regimes
- ranked paper stays narrow and liquid-name focused
- no live expansion until family-by-family edge is proven

## Success criteria

A redesign is working only if it improves these, not just story quality:
- higher favorable-rate after execution costs by family/regime
- lower adverse excursion on entries
- better separation between promoted and demoted symbols/families
- fewer repeated low-quality signals
- cleaner bearish-market behavior
- trustworthy accounting and replayable decisions
