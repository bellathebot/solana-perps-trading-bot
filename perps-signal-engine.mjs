export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map(v => (v - avg) ** 2));
  return Math.sqrt(variance);
}

export function inferRegimeTag(change24h = 0, change60m = 0, realizedVolPct = 0) {
  if (change24h <= -8 || change60m <= -3.5) return 'panic_selloff';
  if (change24h <= -3 || change60m <= -1.5) return 'trend_down';
  if (change24h >= 5 && change60m >= 1.5) return 'stable_uptrend';
  if (realizedVolPct >= 2.5 && change24h > 0) return 'unstable_bounce';
  if (realizedVolPct >= 2.5 && change24h < 0) return 'distribution';
  if (Math.abs(change24h) <= 1.25 && realizedVolPct <= 1.1) return 'calm_range';
  return Math.abs(change24h) >= 1.5 ? 'choppy' : 'stable';
}

export function stableDecisionBucket(ts, minutes = 5) {
  const bucketMs = minutes * 60 * 1000;
  const bucketStart = Math.floor(new Date(ts).getTime() / bucketMs) * bucketMs;
  return new Date(bucketStart).toISOString();
}

export function latestPriceBefore(history, minutesBack) {
  if (!Array.isArray(history) || !history.length) return null;
  const targetTs = Date.now() - (minutesBack * 60 * 1000);
  let chosen = history[0];
  for (const row of history) {
    const ts = new Date(row.ts).getTime();
    if (ts <= targetTs) return row;
    chosen = row;
  }
  return chosen;
}

export function pctChange(from, to) {
  if (!from || !to) return null;
  const fromPrice = safeNumber(from.price_usd, null);
  const toPrice = safeNumber(to.price_usd, null);
  if (!fromPrice || !toPrice) return null;
  return ((toPrice - fromPrice) / fromPrice) * 100;
}

function realizedVolPct(history) {
  if (!Array.isArray(history) || history.length < 4) return 0;
  const returns = [];
  for (let i = 1; i < history.length; i += 1) {
    const prev = safeNumber(history[i - 1]?.price_usd, null);
    const curr = safeNumber(history[i]?.price_usd, null);
    if (!prev || !curr) continue;
    returns.push(((curr - prev) / prev) * 100);
  }
  return stdev(returns);
}

function intradayReference(history, fallbackPrice) {
  if (!Array.isArray(history) || !history.length) return fallbackPrice;
  let weightedPrice = 0;
  let totalWeight = 0;
  for (const row of history) {
    const price = safeNumber(row.price_usd, fallbackPrice);
    const weight = Math.max(1, safeNumber(row.volume_usd_24h, 1));
    weightedPrice += price * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedPrice / totalWeight : fallbackPrice;
}

function slopePct(history, sample = 6) {
  const rows = (history || []).slice(-sample);
  if (rows.length < 2) return 0;
  const first = safeNumber(rows[0]?.price_usd, 0);
  const last = safeNumber(rows[rows.length - 1]?.price_usd, 0);
  if (!first || !last) return 0;
  return ((last - first) / first) * 100;
}

function volumeBucket(volume24h) {
  if (volume24h >= 150_000_000) return 'very_high';
  if (volume24h >= 60_000_000) return 'high';
  if (volume24h >= 20_000_000) return 'medium';
  return 'low';
}

function buildExecutionQuality({ volume24h, realizedVol, drift5m, distanceFromReferencePct, marketRelativeStrength }) {
  let score = 50;
  score += volume24h >= 150_000_000 ? 20 : volume24h >= 60_000_000 ? 12 : volume24h >= 20_000_000 ? 6 : -8;
  score -= clamp(realizedVol * 8, 0, 18);
  score -= clamp(Math.abs(drift5m) * 6, 0, 12);
  score -= clamp(Math.abs(distanceFromReferencePct) * 4, 0, 10);
  score -= clamp(Math.abs(marketRelativeStrength) * 5, 0, 8);
  return clamp(Math.round(score), 0, 100);
}

function buildLongContinuation(metrics) {
  const setup = clamp(
    (metrics.regimeTag === 'stable_uptrend' ? 30 : metrics.regimeTag === 'unstable_bounce' ? 10 : 0) +
    clamp(Math.max(metrics.change15m, 0) * 7, 0, 18) +
    clamp(Math.max(metrics.change60m, 0) * 6, 0, 18) +
    clamp(Math.max(metrics.relativeStrengthVsBasket, 0) * 10, 0, 20) +
    clamp(Math.max(-metrics.pullbackPctFromRecentHigh, 0) * 6, 0, 12),
    0,
    100,
  );
  return setup;
}

function buildLongBreakoutRetest(metrics) {
  const breakoutDistance = Math.max(metrics.change5m, 0);
  const retestIntegrity = Math.max(0, 1 - Math.abs(metrics.distanceFromReferencePct));
  return clamp(
    (metrics.regimeTag === 'stable_uptrend' ? 26 : metrics.regimeTag === 'unstable_bounce' ? 14 : 0) +
    clamp(breakoutDistance * 14, 0, 20) +
    clamp(retestIntegrity * 20, 0, 20) +
    clamp(Math.max(metrics.relativeStrengthVsBasket, 0) * 10, 0, 18),
    0,
    100,
  );
}

function buildShortContinuation(metrics) {
  return clamp(
    (metrics.regimeTag === 'trend_down' ? 26 : metrics.regimeTag === 'panic_selloff' ? 20 : 0) +
    clamp(Math.abs(Math.min(metrics.change15m, 0)) * 8, 0, 20) +
    clamp(Math.abs(Math.min(metrics.change60m, 0)) * 6, 0, 20) +
    clamp(Math.abs(Math.min(metrics.relativeStrengthVsBasket, 0)) * 10, 0, 18) +
    (metrics.volumeBucket === 'very_high' ? 12 : metrics.volumeBucket === 'high' ? 8 : 3),
    0,
    100,
  );
}

function buildShortFailedBounce(metrics) {
  return clamp(
    (metrics.regimeTag === 'panic_selloff' ? 30 : metrics.regimeTag === 'trend_down' ? 22 : 0) +
    clamp(Math.max(metrics.bouncePct, 0) * 8, 0, 20) +
    clamp(Math.abs(Math.min(metrics.change5m, 0)) * 14, 0, 20) +
    clamp(Math.abs(Math.min(metrics.pullbackPctFromRecentHigh, 0)) * 12, 0, 16) +
    clamp(Math.abs(Math.min(metrics.relativeStrengthVsBasket, 0)) * 8, 0, 14),
    0,
    100,
  );
}

function laneSide(signalType) {
  if (signalType.startsWith('perp_long_')) return 'buy';
  if (signalType.startsWith('perp_short_')) return 'sell';
  return 'flat';
}

function timeBucket(ts) {
  const d = new Date(ts);
  const hour = d.getUTCHours();
  if (hour < 6) return 'asia';
  if (hour < 13) return 'europe';
  if (hour < 20) return 'us';
  return 'late_us';
}

export function computePerpsDecision({ market, historyRows, ts, basketMetrics = {} }) {
  const history = historyRows || [];
  const latest = history[history.length - 1] || { price_usd: market.priceUsd ?? market.price_usd, ts };
  const priceNow = safeNumber(latest.price_usd ?? market.priceUsd ?? market.price_usd, 0);
  const row1 = latestPriceBefore(history, 1);
  const row5 = latestPriceBefore(history, 5);
  const row15 = latestPriceBefore(history, 15);
  const row60 = latestPriceBefore(history, 60);
  const change1m = pctChange(row1, latest) ?? 0;
  const change5m = pctChange(row5, latest) ?? 0;
  const change15m = pctChange(row15, latest) ?? 0;
  const change60m = pctChange(row60, latest) ?? 0;
  const change24h = safeNumber(market.changePct24h ?? market.change_pct_24h, 0);
  const volume24h = safeNumber(market.volumeUsd24h ?? market.volume_usd_24h, 0);
  const refPrice = intradayReference(history, priceNow);
  const distanceFromReferencePct = refPrice ? ((priceNow - refPrice) / refPrice) * 100 : 0;
  const low60 = history.length ? Math.min(...history.map(r => safeNumber(r.low_usd_24h ?? r.price_usd, priceNow))) : priceNow;
  const high60 = history.length ? Math.max(...history.slice(-24).map(r => safeNumber(r.price_usd, priceNow))) : priceNow;
  const bouncePct = low60 > 0 ? ((priceNow - low60) / low60) * 100 : 0;
  const pullbackPctFromRecentHigh = high60 > 0 ? ((priceNow - high60) / high60) * 100 : 0;
  const realizedVol = realizedVolPct(history);
  const trendSlopePct = slopePct(history, 8);
  const basket60m = safeNumber(basketMetrics.change60m, 0);
  const basket15m = safeNumber(basketMetrics.change15m, 0);
  const relativeStrengthVsBasket = ((change60m - basket60m) * 0.6) + ((change15m - basket15m) * 0.4);
  const regimeTag = inferRegimeTag(change24h, change60m, realizedVol);
  const executionQualityScore = buildExecutionQuality({
    volume24h,
    realizedVol,
    drift5m: change5m,
    distanceFromReferencePct,
    marketRelativeStrength: relativeStrengthVsBasket,
  });
  const volumeBand = volumeBucket(volume24h);

  const metrics = {
    change1m,
    change5m,
    change15m,
    change60m,
    change24h,
    bouncePct,
    pullbackPctFromRecentHigh,
    volume24h,
    volumeBucket: volumeBand,
    low60,
    high60,
    referencePrice: refPrice,
    distanceFromReferencePct,
    realizedVolPct: realizedVol,
    trendSlopePct,
    relativeStrengthVsBasket,
    regimeTag,
    timeBucket: timeBucket(ts),
  };

  const laneSpecs = [
    { signalType: 'perp_short_continuation', setup: buildShortContinuation(metrics), regimeAllowed: ['trend_down', 'panic_selloff', 'distribution'] },
    { signalType: 'perp_short_failed_bounce', setup: buildShortFailedBounce(metrics), regimeAllowed: ['trend_down', 'panic_selloff', 'distribution'] },
    { signalType: 'perp_long_continuation', setup: buildLongContinuation(metrics), regimeAllowed: ['stable_uptrend', 'unstable_bounce'] },
    { signalType: 'perp_long_breakout_retest', setup: buildLongBreakoutRetest(metrics), regimeAllowed: ['stable_uptrend', 'unstable_bounce'] },
  ];

  const lanes = laneSpecs.map(spec => {
    const eligibility = clamp(
      (spec.regimeAllowed.includes(regimeTag) ? 45 : 5) +
      (volumeBand === 'very_high' ? 25 : volumeBand === 'high' ? 18 : volumeBand === 'medium' ? 8 : -10) +
      clamp(18 - realizedVol * 5, -10, 18),
      0,
      100,
    );
    const execution = executionQualityScore;
    const costHurdlePct = 0.14 + clamp(realizedVol * 0.06, 0.02, 0.30);
    const rawEdgePct = clamp((spec.setup * 0.018) + (eligibility * 0.004) + (execution * 0.0025) - (realizedVol * 0.08), -2.5, 3.5);
    const expectedEdgeAfterCostsPct = rawEdgePct - costHurdlePct;
    const composite = clamp(Math.round((eligibility * 0.28) + (spec.setup * 0.46) + (execution * 0.26)), 0, 100);
    return {
      signalType: spec.signalType,
      side: laneSide(spec.signalType),
      eligibilityScore: eligibility,
      setupQualityScore: spec.setup,
      executionQualityScore: execution,
      expectedEdgePct: rawEdgePct,
      expectedEdgeAfterCostsPct,
      costHurdlePct,
      compositeScore: composite,
      regimeAllowed: spec.regimeAllowed,
      status: composite >= 60 && expectedEdgeAfterCostsPct > 0 ? 'candidate' : 'skipped',
      reason: composite >= 60 && expectedEdgeAfterCostsPct > 0 ? 'multi_gate_candidate' : 'below_multi_gate_threshold',
      setupFamily: spec.signalType.includes('breakout') ? 'breakout_retest' : spec.signalType.includes('failed_bounce') ? 'failed_bounce' : 'continuation',
    };
  });

  const bestActionableScore = Math.max(...lanes.filter(l => l.signalType !== 'perp_no_trade').map(l => l.compositeScore));
  const noTradeBase = bestActionableScore >= 65 ? 32 : 72 - Math.round(bestActionableScore / 2);
  const noTradeEdge = Math.max(...lanes.map(l => l.expectedEdgeAfterCostsPct));
  const noTradeScore = clamp(Math.round(noTradeBase + (noTradeEdge <= 0 ? 10 : -4)), 0, 100);

  const lanesWithGap = lanes.map(l => ({
    ...l,
    scoreGapVsNoTrade: Number((l.compositeScore - noTradeScore).toFixed(4)),
  }));

  const noTradeLane = {
    signalType: 'perp_no_trade',
    side: 'flat',
    eligibilityScore: 100,
    setupQualityScore: noTradeScore,
    executionQualityScore: executionQualityScore,
    expectedEdgePct: 0,
    expectedEdgeAfterCostsPct: 0,
    costHurdlePct: 0,
    compositeScore: noTradeScore,
    scoreGapVsNoTrade: 0,
    status: 'candidate',
    reason: noTradeEdge > 0 ? 'shadow_only_best_edge_not_convincing' : 'no_trade_when_expected_edge_after_costs_is_negative',
    setupFamily: 'no_trade',
  };

  const finalLanes = [...lanesWithGap, noTradeLane].map(lane => ({
    ...lane,
    metadata: {
      regime_family: regimeTag,
      setup_family: lane.setupFamily,
      eligibility_score: lane.eligibilityScore,
      setup_quality_score: lane.setupQualityScore,
      execution_quality_score: lane.executionQualityScore,
      expected_edge_pct: lane.expectedEdgePct,
      expected_edge_after_costs_pct: lane.expectedEdgeAfterCostsPct,
      cost_hurdle_pct: lane.costHurdlePct,
      score_gap_vs_no_trade: lane.scoreGapVsNoTrade,
      market_metrics: metrics,
    },
  }));

  const bestActionLane = finalLanes
    .filter(l => l.signalType !== 'perp_no_trade')
    .sort((a, b) => b.compositeScore - a.compositeScore || b.expectedEdgeAfterCostsPct - a.expectedEdgeAfterCostsPct)[0] || null;

  return {
    ts,
    decisionId: `tiny-live-perps:${market.asset}:${stableDecisionBucket(ts, 5)}`,
    regimeTag,
    priceNow,
    metrics,
    bestActionLane,
    lanes: finalLanes,
  };
}
