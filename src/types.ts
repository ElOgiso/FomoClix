export interface TrackedCreator {
  id: string;
  address: string;
  name: string;
  handle: string;
  status: 'active' | 'paused' | 'disabled';
  autoSellEnabled: boolean;
  stopLossEnabled: boolean;
  customBuyAmount: number;
  sellAfterUsers: number;
  antiRekt: {
    maxBuyTax: number;
    maxSellTax: number;
    minLiquidityEth: number;
    devReputationScore: number;
  };
  sellAllAtOnce?: boolean;
  maxSlippageOverride?: number;
  creatorTradeAmountOverride?: number;
  followerOverride?: boolean;
  pauseTracking?: boolean;
  emergencyDisable?: boolean;
  notes?: string;
  avatarUrl?: string;
  fid?: number;
  coinsBoughtCount?: number;
  lastActivity?: string;
  lifetimePnLEth?: number;
}

export interface ActivePosition {
  id: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  boughtAt: string;
  entryEth: number;
  entryUsd: number;
  receivedTokens: number;
  initialHolders: number;
  currentHolders: number;
  liveMarketCap: number;
  liveValueUsd: number;
  liveProfitPercent: number;
  liveProfitUsd: number;
  momentum: 'up' | 'down' | 'flat';
  momentumAtBuy?: string;
  autoSellStatus?: 'ENABLED' | 'DISABLED';
  currentStatus?: 'HOLD' | 'SELLING' | 'MANUAL_OVERWRITE' | 'MONITORING';
  txHash?: string;
  creatorAddress?: string;
}

export interface HistoricalTrade {
  id: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  soldAt: string;
  costEth: number;
  receivedEth: number;
  profitPercent: number;
  sellReason: string;
}

export interface ActivityLog {
  id: string;
  type: 'SCAN' | 'WARN' | 'HIT' | 'CALC' | 'TX' | 'CONF' | 'ERROR' | 'INFO';
  text: string;
  timestamp: string;
}

export interface ActivityFeedEvent {
  id: string;
  type: 'BUY_SUCCESS' | 'BUY_FAIL' | 'SOCIAL_AUDIT' | 'COIN_STATS_CHECK' | 'MOMENTUM_UPDATE' | 'SNIPER_METRICS' | 'CONTENT_COIN_V4' | 'CREATOR_COIN_PROFILE' | string;
  coinName?: string;
  coinSymbol?: string;
  tokenAddress?: string;
  creatorAddress?: string;
  txHash?: string;
  timestamp: string;
  statusResult?: string;
  errorReason?: string;
  marketCap?: number;
  holdersCount?: number;
  riskScore?: number;
  chain?: string;
}

export interface ScannerEvent {
  id: string;
  chain?: string;
  eventType: 'SCANNING_COIN' | 'COIN_STATS_CHECK' | 'SOCIAL_AUDIT' | 'MOMENTUM_UPDATE' | 'BUY_SUCCESS' | 'BUY_FAIL' | 'TREND_COIN_DETECTED' | 'SNIPER_METRICS';
  coinName: string;
  coinSymbol: string;
  tokenAddress: string;
  creatorAddress: string;
  creatorHandle?: string;
  marketCap?: number;
  holdersCount?: number;
  momentum?: string;
  timestamp: string;
  statusResult: 'PASSED' | 'FAILED' | 'PENDING' | 'BOUGHT' | 'SKIPPED' | 'WARNING';
  riskScore: number; // 0 - 100
  auditDetails: string;
  liquidityLockedPercent?: number;
  buyTax?: number;
  sellTax?: number;
  compilerVerified?: boolean;
}

export interface BotStrategy {
  minLiquidityEth: number;
  maxBuyTax: number;
  maxSellTax: number;
  minHolders: number;
  maxSlippage: number;
  gasSurchargeGwei: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  autoSellEnabled: boolean;
  socialAuditEnabled: boolean;
  devScoreMinimum: number;
  botState: 'ACTIVE' | 'PAUSED' | 'SIMULATION';
  tradeCurrency: 'ETH' | 'WETH' | 'USDC';
  tradeAmountEth: number;
  creatorTradeAmountEth: number;
  contentTradeAmountEth: number;
  targetKeywords: string[];
  symbolTargetingEnabled: boolean;
  requireFourLetterSymbol: boolean;
  requireAllCapsSymbol: boolean;
  taxArbitrageEnabled: boolean;
  taxTimerEnabled: boolean;
  microInertiaEnabled: boolean;
  preBuyMomentumEnabled: boolean;
  trendingSnipingEnabled: boolean;
  takeProfitUsd: number;
  maxPriorityFeeGwei: number;
  notifyTxSuccess: boolean;
  notifyTxRevert: boolean;
  soundBuzzer: boolean;
  maxCreatorCoinsPerDay: number;
  bypassCreatorFollowerCheck: boolean;
  creatorFollowerThreshold: number;
  exclusionPhrases: string[];
  freeTraderMode: boolean;
}

export interface BotStatusResponse {
  botRunning: boolean;
  wsConnected: boolean;
  uptime: string;
  gasPrice: number;
  ethPrice: number;
  walletBalance: {
    eth: number;
    usdc: number;
  };
  cpuLoad?: number[];
  memoryUsage?: string;
}

export interface TradingWallet {
  address: string;
  exists: boolean;
  backupConfirmed: boolean;
  chain?: string;
}

export interface OnboardingStatus {
  role: 'admin' | 'user';
  onboardingComplete: boolean;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  riskAccepted: boolean;
  hasTradingWallet: boolean;
  backupConfirmed: boolean;
  plan: 'payg' | 'weekly' | 'admin' | null;
  subscriptionActive: boolean;
  weeklyRenewalDue: number | null;
  profileTag: 'Gold User' | 'Pay As You Go' | 'Subscribed' | null;
  tradingWalletAddress: string | null;
}

export interface SubscriptionStatus {
  plan: 'payg' | 'weekly' | 'admin' | null;
  subscriptionActive: boolean;
  profileTag: string | null;
  role: 'admin' | 'user';
  weeklyRenewalDue: number | null;
  daysUntilRenewal: number | null;
}

export interface UserProfile {
  role: 'admin' | 'user';
  profileTag: 'Gold User' | 'Pay As You Go' | 'Subscribed' | null;
  plan: 'payg' | 'weekly' | 'admin' | null;
  subscriptionActive: boolean;
  weeklyRenewalDue: number | null;
}
