/**
 * FOMOCLIX AI OS — Strategy Engine
 * Computes deterministic trade ratings, position sizes, stop-losses, and expected value (EV).
 * Optimized specifically for low-budget accounts ($0.50 to $10).
 */

/**
 * Executes trading math scoring, evaluating risk and sizing limits.
 */
function evaluateStrategyRules({ tokenIntel, botConfig, walletBalance = 0, activeChain = 'zora', ethPrice = 3500 }) {
  const { marketCap, liquidityUsd, buyTax, sellTax, devReputation, riskScore } = tokenIntel;

  // 1. Calculate Liquidity Score
  // Ideal liquidity is > $10,000 for low slippage. Score starts at 100 and penalizes low pools.
  let liquidityScore = 100;
  if (liquidityUsd < 2000) liquidityScore = 20;
  else if (liquidityUsd < 5000) liquidityScore = 55;
  else if (liquidityUsd < 10000) liquidityScore = 80;

  // 2. Compute overall Opportunity Score
  // Factoring in creator reputation, low taxes, and liquidity
  let opportunityScore = Math.floor((devReputation * 0.4) + (liquidityScore * 0.4) + ((100 - riskScore) * 0.2));
  
  // Tax Penalties
  if (buyTax > 5 || sellTax > 5) opportunityScore -= 20;

  // 3. LOW BUDGET POSITION SIZING (FOMOCLIX Core)
  // Low-budget optimization handles default sizes and estimates relative transaction overheads.
  const estimatedGasUsd = activeChain === 'solana' ? 0.05 : 1.25; // standard L2 L1 fees
  const budgetSelector = botConfig.tradeAmountEth || 0.001; // default eth buy
  const positionSizeUsd = budgetSelector * ethPrice;

  // Check if gas cost exceeds 15% of position size
  const gasOverheadPct = (estimatedGasUsd / positionSizeUsd) * 100;
  let suitabilityCode = 'SUITABLE';
  let sizingFactor = 1.0;

  if (gasOverheadPct > 35) {
    suitabilityCode = 'UNSUITABLE_EXCESSIVE_GAS';
    sizingFactor = 0.0; // reject buy proposal
  } else if (gasOverheadPct > 15) {
    suitabilityCode = 'WARNING_HIGH_GAS_COST';
    sizingFactor = 0.5; // shrink size to conserve funds
  }

  // Final adjusted position size
  const suggestedBuyAmount = Math.max(budgetSelector * sizingFactor, 0.0001);

  // 4. STOP LOSS & TAKE PROFIT ZONES
  // Low budget requires tighter stop-losses and realistic take profits
  let stopLoss = 20; // 20%
  let takeProfit = 40; // 40%

  if (riskScore > 50) {
    // High risk: Tight SL, quick exit TP
    stopLoss = 15;
    takeProfit = 30;
  } else if (riskScore < 20) {
    // Low risk: Give room to grow
    stopLoss = 25;
    takeProfit = 60;
  }

  // 5. EXPECTED VALUE & WIN PROBABILITY
  // Deterministic Win Probability based on safety score metrics
  const winProbability = Math.min(Math.max((100 - riskScore) / 100, 0.1), 0.9);
  const lossProbability = 1.0 - winProbability;
  
  // EV = (WinProb * TakeProfit) - (LossProb * StopLoss)
  const expectedValuePct = (winProbability * takeProfit) - (lossProbability * stopLoss);

  return {
    opportunityScore: Math.max(opportunityScore, 0),
    liquidityScore,
    riskRating: riskScore > 50 ? 'HIGH' : riskScore > 20 ? 'MEDIUM' : 'LOW',
    suitability: suitabilityCode,
    suggestedBuyAmount,
    gasOverheadPercent: gasOverheadPct,
    takeProfitPercent: takeProfit,
    stopLossPercent: stopLoss,
    winProbability,
    expectedValuePercent: expectedValuePct,
    confidenceRating: Math.floor(opportunityScore * 0.9)
  };
}

module.exports = {
  evaluateStrategyRules
};
